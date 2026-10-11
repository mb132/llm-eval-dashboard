import { ChartColumn, Cpu, Database, History, LayoutDashboard, MessageSquareText, Plus, SquareTerminal } from "lucide-react"
import { Link, NavLink, useLocation } from "react-router-dom"

import { buttonVariants } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { cn } from "@/lib/utils"

const groups = [
  { label: "Analyze", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/evaluations/history", label: "Runs", icon: History },
    { to: "/playground", label: "Playground", icon: SquareTerminal },
  ] },
  { label: "Library", items: [
    { to: "/prompts", label: "Prompts", icon: MessageSquareText },
    { to: "/datasets", label: "Datasets", icon: Database },
    { to: "/models", label: "Models", icon: Cpu },
  ] },
]

export function BrandMark() {
  return <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"><ChartColumn className="size-3.5" strokeWidth={2.5} aria-hidden="true" /></span>
}

export function SidebarNav({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const newCurrent = pathname === "/evaluations/new"
  return <nav aria-label="Primary" className="flex h-full min-h-0 flex-col gap-5 px-3 pb-4 pt-3.5">
    <Link to="/" onClick={onNavigate} className={cn("flex items-center gap-2 font-mono text-body font-medium text-fg", mobile && "min-h-11")}><BrandMark />llm-eval</Link>
    {groups.map((group) => <div key={group.label}>
      <div className="px-2.5 pb-1.5 text-overline uppercase text-fg-muted">{group.label}</div>
      {group.items.map(({ to, label, icon: Icon }) => {
        const active = label === "Runs"
          ? pathname.startsWith("/evaluations/") && !newCurrent
          : to === "/" ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
        // Runs includes detail routes even though its destination is the history list.
        const NavigationLink = label === "Runs" ? Link : NavLink
        return <NavigationLink key={to} to={to} onClick={onNavigate} aria-current={active ? "page" : undefined}
          className={cn("flex items-center gap-2.5 rounded-md px-2.5 text-body text-fg-secondary hover:bg-hover hover:text-fg", mobile ? "h-11" : "h-9", active && "bg-hover font-medium text-fg")}>
          <Icon className={cn("size-4", active && "text-primary")} aria-hidden="true" />{label}
        </NavigationLink>
      })}
    </div>)}
    <div className="mt-auto flex flex-col gap-2">
      <ThemeToggle className={mobile ? "[&_button]:h-11" : undefined} />
      <Link to="/evaluations/new" onClick={onNavigate} aria-current={newCurrent ? "page" : undefined}
        className={cn(buttonVariants({ variant: newCurrent ? "outline" : "default" }), "w-full", mobile && "h-11", newCurrent && "border-primary bg-hover")}><Plus aria-hidden="true" />New evaluation</Link>
    </div>
  </nav>
}
