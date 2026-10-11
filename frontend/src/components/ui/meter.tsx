import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

function clamp(value: number) { return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0 }
type MeterBarProps = Omit<ComponentProps<"div">, "children"> & { value: number }
function MeterBar({ value, className, ...props }: MeterBarProps) {
  const safeValue = clamp(value)
  return <div role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={safeValue} className={cn("h-1.5 overflow-hidden rounded-full bg-line", className)} {...props}>
    <div className="h-full rounded-full bg-primary" style={{ width: `${safeValue * 100}%` }} />
  </div>
}

type SplitSegment = { value: number; tone: "success" | "destructive" | "info" | "line" }
/** Segments are raw nonnegative weights normalized to the track; value is optional 0..1 progress. */
type SplitBarProps = Omit<ComponentProps<"div">, "children"> & { segments: SplitSegment[]; value?: number }
const tones = { success: "bg-success", destructive: "bg-destructive", info: "bg-info", line: "bg-line" }
function SplitBar({ segments, value, className, role, ...props }: SplitBarProps) {
  const weights = segments.map(({ value: weight }) => Number.isFinite(weight) ? Math.max(0, weight) : 0)
  const maximum = Math.max(...weights, 0)
  // Scale before summing so even very large finite request counts cannot overflow.
  const total = weights.reduce((sum, weight) => sum + (maximum ? weight / maximum : 0), 0)
  return <div role={role} aria-valuemin={role === "progressbar" ? 0 : undefined} aria-valuemax={role === "progressbar" ? 1 : undefined} aria-valuenow={role === "progressbar" && value !== undefined ? clamp(value) : undefined} className={cn("flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-line", className)} {...props}>
    {segments.map((segment, index) => weights[index] > 0 && <div key={index} className={cn("min-w-0 rounded-full", tones[segment.tone])} style={{ flexBasis: 0, flexGrow: total ? weights[index] / maximum / total : 0 }} />)}
  </div>
}
export { MeterBar, SplitBar, type MeterBarProps, type SplitBarProps, type SplitSegment }
