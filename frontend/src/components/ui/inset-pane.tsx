import { useId, type ComponentProps, type ReactNode } from "react"
import { cn } from "@/lib/utils"

function ResultPanes({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid min-w-0 gap-px overflow-hidden rounded-md border border-line-strong bg-line-strong md:grid-cols-3", className)} {...props} />
}
type InsetPaneProps = Omit<ComponentProps<"section">, "title"> & { label: ReactNode; verdict?: ReactNode; verdictTone?: "destructive" | "success" | "warning" | "info" | "neutral"; mono?: boolean }
const verdictTones = { destructive: "text-destructive", success: "text-success", warning: "text-warning", info: "text-info", neutral: "text-fg-muted" }
function InsetPane({ label, verdict, verdictTone = "destructive", mono, children, className, ...props }: InsetPaneProps) {
  const id = useId()
  return <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-1.5 bg-inset p-3", className)} {...props}>
    <div className="flex flex-wrap items-start justify-between gap-2"><span id={id} className="text-overline uppercase text-fg-muted">{label}</span>{verdict && <span className={cn("min-w-0 text-data-sm [overflow-wrap:anywhere]", verdictTones[verdictTone])}>{verdict}</span>}</div>
    <div className={cn("min-w-0 whitespace-pre-wrap break-words text-body [overflow-wrap:anywhere]", mono && "font-mono")}>{children}</div>
  </section>
}
export { InsetPane, ResultPanes, type InsetPaneProps }
