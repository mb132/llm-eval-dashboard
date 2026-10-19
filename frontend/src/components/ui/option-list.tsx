import { useId, type ComponentProps, type ReactNode } from "react"
import { cn } from "@/lib/utils"

function OptionList({ className, embedded = false, ...props }: ComponentProps<"div"> & { embedded?: boolean }) {
  return <div className={cn("min-w-0 overflow-hidden bg-panel", !embedded && "rounded-lg border border-line", className)} {...props} />
}
type SelectableRowProps = Omit<ComponentProps<"input">, "type" | "onChange" | "children"> & {
  type?: "checkbox" | "radio"
  label: ReactNode
  description?: ReactNode
  hint?: ReactNode
  onCheckedChange: (checked: boolean) => void
}
function SelectableRow({ label, description, hint, checked, disabled, type = "checkbox", className, id, onCheckedChange, ...props }: SelectableRowProps) {
  const generated = useId()
  const controlId = id ?? generated
  const descriptionId = `${controlId}-description`
  return <label className={cn("flex min-h-[52px] min-w-0 items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 max-md:min-h-14", checked && "bg-selected", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover", className)}>
    <input {...props} id={controlId} type={type} checked={checked} disabled={disabled} onChange={(event) => onCheckedChange(event.target.checked)} aria-describedby={[props["aria-describedby"], description != null ? descriptionId : undefined].filter(Boolean).join(" ") || undefined} className="size-4 shrink-0 accent-primary max-md:size-5" />
    <span className="flex min-w-0 flex-1 flex-col gap-1 [overflow-wrap:anywhere]"><span className="text-body text-fg">{label}</span>{description != null && <> <span id={descriptionId} className="font-mono text-data-sm text-fg-muted">{description}</span></>}</span>
    {hint != null && <> <span className="min-w-0 text-right font-mono text-data [overflow-wrap:anywhere]">{hint}</span></>}
  </label>
}
export { OptionList, SelectableRow, type SelectableRowProps }
