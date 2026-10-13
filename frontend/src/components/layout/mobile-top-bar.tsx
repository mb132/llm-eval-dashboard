import { Menu } from "lucide-react"
import type { RefObject } from "react"
import { Link, useLocation } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import type { PageChrome } from "./page-context"
import { BrandMark } from "./sidebar-nav"

export function MobileTopBar({ chrome, open, onOpen, triggerRef }: {
  chrome: PageChrome
  open: boolean
  onOpen: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const { pathname } = useLocation()
  return <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-line bg-chrome pl-2 pr-3 md:hidden">
    <Button ref={triggerRef} variant="ghost" size="icon-lg" aria-label="Open navigation" aria-expanded={open} aria-controls="navigation-drawer" onClick={onOpen}><Menu aria-hidden="true" /></Button>
    <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2 font-mono text-body font-medium text-fg"><BrandMark /><span className="truncate">{chrome.mobileTitle ?? chrome.breadcrumbs[0]?.label}</span></Link>
    <div className="ml-auto flex shrink-0 items-center gap-2" onClick={(event) => {
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null
      if (!anchor?.hash || anchor.pathname !== pathname || anchor.origin !== window.location.origin) return
      let targetId: string
      try { targetId = decodeURIComponent(anchor.hash.slice(1)) } catch { return }
      const target = document.getElementById(targetId)
      target?.scrollIntoView({ block: "start" })
      target?.querySelector<HTMLElement>("input:not(:disabled):not([type='hidden']), textarea:not(:disabled)")?.focus({ preventScroll: true })
    }}><ThemeToggle variant="mobile" />{chrome.mobileAction}</div>
  </header>
}
