import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

type StepPanelProps = Omit<ComponentProps<"fieldset">, "title"> & { step: ReactNode; title: ReactNode; caption?: ReactNode; count?: ReactNode; actions?: ReactNode; contentClassName?: string; padded?: boolean }
function StepPanel({ step, title, caption, count, actions, children, className, contentClassName, padded = true, ...props }: StepPanelProps) {
  return <fieldset className={cn("min-w-0 rounded-lg border border-line bg-panel disabled:opacity-50", className)} {...props}>
    <legend className="sr-only">{step} {title}</legend>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
      <span aria-hidden="true" className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-sm bg-hover font-mono text-primary">{step}</span>
      <span aria-hidden="true" className="min-w-0 text-section [overflow-wrap:anywhere]">{title}</span>
      {caption != null && <span className="min-w-0 text-caption text-fg-muted [overflow-wrap:anywhere]">{caption}</span>}
      <span className="flex-1" />{count != null && <span className="font-mono text-data text-fg-muted">{count}</span>}{actions}
    </div>
    <div className={cn("min-w-0", padded && "p-4 max-md:p-3", contentClassName)}>{children}</div>
  </fieldset>
}
export { StepPanel, type StepPanelProps }
