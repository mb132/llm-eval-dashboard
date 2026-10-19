import { X } from "lucide-react"
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react"

import { Button } from "@/components/ui/button"

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
}

const focusableSelector = "button, a[href], input, select, textarea, [tabindex], [contenteditable='true']"
let scrollLocks = 0
let previousOverflow = ""
const activeDialogs: HTMLElement[] = []

function isAvailable(element: HTMLElement) {
  if (element.matches(":disabled, input[type='hidden']") || element.closest("[hidden], [inert], [aria-hidden='true']")) return false
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false
  }
  return true
}

function focusableElements(container: HTMLElement) {
  const elements = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.tabIndex >= 0 && isAvailable(element))
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity))
  return elements.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name) return true
    const group = elements.filter((candidate): candidate is HTMLInputElement =>
      candidate instanceof HTMLInputElement && candidate.type === "radio" &&
      candidate.name === element.name && candidate.form === element.form,
    )
    return element === (group.find((radio) => radio.checked) ?? group[0])
  })
}

function Dialog({ open, onOpenChange, title, description, children, footer, initialFocusRef }: DialogProps) {
  const id = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const optionsRef = useRef({ onOpenChange, initialFocusRef })

  // Inline callbacks and form updates must not restart the opening lifecycle.
  useEffect(() => {
    optionsRef.current = { onOpenChange, initialFocusRef }
  }, [onOpenChange, initialFocusRef])

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (scrollLocks === 0) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = "hidden"
    }
    scrollLocks += 1
    activeDialogs.push(dialog)

    const elements = focusableElements(dialog)
    const explicitFocus = optionsRef.current.initialFocusRef?.current
    const firstField = elements.find((element) => element.matches("input, select, textarea, [contenteditable='true'], [role='combobox']"))
    const initial = explicitFocus && dialog.contains(explicitFocus) && isAvailable(explicitFocus)
      ? explicitFocus
      : firstField ?? elements.find((element) => element !== closeRef.current) ?? elements[0] ?? dialog
    initial.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeDialogs.at(-1) !== dialog) return
      if (event.key === "Escape") {
        event.preventDefault()
        optionsRef.current.onOpenChange(false)
      } else if (event.key === "Tab") {
        const candidates = focusableElements(dialog)
        event.preventDefault()
        if (candidates.length === 0) {
          dialog.focus()
          return
        }
        const index = candidates.indexOf(document.activeElement as HTMLElement)
        const next = index < 0 ? (event.shiftKey ? candidates.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + candidates.length) % candidates.length
        candidates[next].focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (activeDialogs.at(-1) !== dialog) return
      if (!dialog.contains(event.target as Node)) {
        (focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true })
      }
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("focusin", onFocusIn)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("focusin", onFocusIn)
      const wasTopDialog = activeDialogs.at(-1) === dialog
      activeDialogs.splice(activeDialogs.indexOf(dialog), 1)
      scrollLocks -= 1
      if (scrollLocks === 0) document.body.style.overflow = previousOverflow
      if (wasTopDialog && trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg border border-line-strong bg-panel text-fg sm:max-h-[90vh] sm:max-w-[560px] sm:rounded-lg max-sm:[&_button:not([role=switch])]:min-h-11 max-sm:[&_input:not([type=checkbox]):not([type=radio])]:min-h-11 max-sm:[&_select]:min-h-11 max-sm:[&_input]:text-[14px] max-sm:[&_select]:text-[14px] max-sm:[&_textarea]:text-[14px]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="text-[16px] leading-6 font-semibold">{title}</h2>
            {description && <p id={`${id}-description`} className="text-caption text-fg-muted">{description}</p>}
          </div>
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 max-sm:w-11"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export { Dialog }
