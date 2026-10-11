import { ChevronLeft, Plus } from "lucide-react"
import { useCallback, useRef, useState, type ReactNode } from "react"
import { Link, useLocation } from "react-router-dom"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MobileTopBar } from "./mobile-top-bar"
import { NavigationDrawer } from "./navigation-drawer"
import { PageChromeContext, type PageChrome } from "./page-context"
import { SidebarNav } from "./sidebar-nav"
import { TopBar } from "./top-bar"

function routeChrome(pathname: string, search: string): PageChrome {
  const segments = pathname.split("/").filter(Boolean)
  const section = segments[0]
  const label = ({ evaluations: "Runs", prompts: "Prompts", datasets: "Datasets", playground: "Playground", models: "Models" } as Record<string, string>)[section] ?? "Dashboard"
  const root = section === "evaluations" ? "/evaluations/history" : `/${section}`
  const detail = segments[1] && segments[1] !== "history"
  const id = (section === "evaluations" ? segments[1]?.slice(0, 8) : segments[1]) ?? ""
  const run = new URLSearchParams(search).get("run")
  const breadcrumbs = detail ? [{ label, to: root }, { label: id, title: segments[1] }]
    : [{ label }, ...(pathname === "/" && run ? [{ label: run.slice(0, 8), title: run }] : [])]
  const newEvaluation = pathname === "/" || (section === "evaluations" && segments[1] !== "new")
  const newLibrary = pathname === "/prompts" || pathname === "/datasets"
  const mobileAction = newEvaluation || newLibrary ? <Link
    to={newEvaluation ? "/evaluations/new" : `${pathname}#create-${section === "prompts" ? "prompt" : "dataset"}`}
    className={cn(buttonVariants({ variant: newEvaluation ? "default" : "outline" }), "h-11")}><Plus aria-hidden="true" />New</Link> : undefined
  return { breadcrumbs, mobileTitle: label, mobileAction, mobileBack: detail ? { label, to: root } : undefined }
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [registered, setRegistered] = useState<{ key: string; chrome: PageChrome; token: object } | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const register = useCallback((key: string, chrome: PageChrome) => {
    const token = {}
    setRegistered({ key, chrome, token })
    return () => setRegistered((current) => current?.token === token ? null : current)
  }, [])
  const fallback = routeChrome(location.pathname, location.search)
  const configured = registered?.key === location.key
  const chrome = configured ? {
    ...fallback,
    ...registered.chrome,
    mobileTitle: registered.chrome.mobileTitle ?? fallback.mobileTitle,
    mobileBack: registered.chrome.mobileBack ?? fallback.mobileBack,
    mobileAction: registered.chrome.mobileAction === undefined ? fallback.mobileAction : registered.chrome.mobileAction,
  } : fallback
  return <PageChromeContext.Provider value={register}>
    <div className="flex min-h-screen bg-canvas text-fg">
      <aside className="sticky top-0 hidden h-screen w-[208px] shrink-0 overflow-y-auto border-r border-line bg-chrome md:block"><SidebarNav /></aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar {...chrome} />
        <MobileTopBar chrome={chrome} open={drawerOpen} onOpen={() => setDrawerOpen(true)} triggerRef={triggerRef} />
        <main className="flex w-full min-w-0 max-w-[1280px] flex-col gap-4 p-4 md:gap-5 md:p-6">
          {(!configured || registered.chrome.mobileBack === undefined) && chrome.mobileBack && <Link to={chrome.mobileBack.to} className="flex min-h-11 items-center gap-1 font-mono text-data text-fg-secondary md:hidden"><ChevronLeft className="size-3.5" aria-hidden="true" />{chrome.mobileBack.label}</Link>}
          {children}
        </main>
      </div>
      <NavigationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} triggerRef={triggerRef} />
    </div>
  </PageChromeContext.Provider>
}
