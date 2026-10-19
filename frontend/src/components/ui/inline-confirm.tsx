import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type InlineConfirmProps = {
  open?: boolean
  message: ReactNode
  label?: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  pending?: boolean
  className?: string
}
function InlineConfirm({ open = true, message, label = "Confirm action", confirmLabel, onConfirm, onCancel, returnFocusRef, pending, className }: InlineConfirmProps) {
  const messageId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const focusRef = useRef(returnFocusRef)
  useEffect(() => { focusRef.current = returnFocusRef }, [returnFocusRef])
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    return () => {
      const target = focusRef.current?.current ?? trigger
      if (target?.isConnected) target.focus({ preventScroll: true })
    }
  }, [open])
  if (!open) return null
  return <div role="alertdialog" aria-label={label} aria-describedby={messageId} className={cn("flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-destructive-soft px-3 py-2.5 text-destructive", className)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel() } }}>
    <span id={messageId} className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">{message}</span>
    <Button ref={cancelRef} type="button" variant="outline" size="xs" className="max-md:h-11" aria-describedby={messageId} onClick={onCancel}>Cancel</Button>
    <Button type="button" variant="destructive" size="xs" className="max-md:h-11" disabled={pending} onClick={onConfirm}>{confirmLabel}</Button>
  </div>
}
export { InlineConfirm, type InlineConfirmProps }
