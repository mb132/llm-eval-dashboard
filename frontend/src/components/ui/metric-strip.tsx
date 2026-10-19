import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

function MetricStrip({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]", className)} {...props} />
}

type MetricCellProps = Omit<ComponentProps<"div">, "children"> & {
  label: ReactNode
  value?: ReactNode
  unit?: ReactNode
  visual?: ReactNode
  subValue?: ReactNode
  warning?: boolean
}

function MetricCell({ label, value, unit, visual, subValue, warning, className, ...props }: MetricCellProps) {
  const missing = value === undefined || value === null || value === "—"
  return <div className={cn("flex min-w-0 flex-col gap-1.5 bg-panel p-3 [overflow-wrap:anywhere] md:p-4", className)} {...props}>
    <div className="text-caption text-fg-muted">{label}</div>
    <div className={cn("font-mono text-metric-lg", missing && "text-fg-muted")}>
      {missing ? "—" : value}{!missing && unit && <span className="text-[16px] text-fg-muted"> {unit}</span>}
    </div>
    {visual}
    {subValue != null && <div className={cn("font-mono text-data-sm text-fg-muted", warning && "text-warning")}>{warning && <span aria-hidden="true">⚠ </span>}{subValue}</div>}
  </div>
}

export { MetricStrip, MetricCell, type MetricCellProps }
