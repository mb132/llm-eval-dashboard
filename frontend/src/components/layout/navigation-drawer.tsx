import { X } from "lucide-react"
import { useEffect, useRef, type RefObject } from "react"

import { Button } from "@/components/ui/button"
import { SidebarNav } from "./sidebar-nav"

export function NavigationDrawer({ open, onClose, triggerRef }: {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open || !drawerRef.current) return
    const drawer = drawerRef.current
    const trigger = triggerRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const focusable = () => Array.from(drawer.querySelectorAll<HTMLElement>("a[href], button, [tabindex='0']"))
      .filter((element) => element.tabIndex >= 0 && !(element instanceof HTMLButtonElement && element.disabled) && !element.closest("[hidden], [inert]"))
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeRef.current()
      } else if (event.key === "Tab") {
        event.preventDefault()
        const elements = focusable()
        const index = elements.indexOf(document.activeElement as HTMLElement)
        const next = index < 0 ? (event.shiftKey ? elements.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length
        ;(elements[next] ?? drawer).focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!drawer.contains(event.target as Node)) (focusable()[0] ?? drawer).focus()
    }
    const onResize = () => { if (window.matchMedia?.("(min-width: 768px)").matches) closeRef.current() }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("focusin", onFocusIn)
    window.addEventListener("resize", onResize)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("focusin", onFocusIn)
      window.removeEventListener("resize", onResize)
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open, triggerRef])
  if (!open) return null
  return <div className="fixed inset-0 z-50 bg-overlay" role="presentation" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onClose()
  }}>
    <div ref={drawerRef} id="navigation-drawer" role="dialog" aria-modal="true" aria-label="Navigation" tabIndex={-1}
      className="flex h-dvh w-[280px] max-w-full flex-col border-r border-line bg-chrome text-fg">
      <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-section">Navigation</span>
        <Button variant="ghost" size="icon-lg" aria-label="Close navigation" onClick={onClose}><X aria-hidden="true" /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto"><SidebarNav mobile onNavigate={onClose} /></div>
    </div>
  </div>
}
