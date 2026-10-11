import type { ComponentProps, ReactNode } from "react"
import { AlertTriangle, Inbox } from "lucide-react"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & { title: ReactNode; description?: ReactNode; icon?: ReactNode; action?: ReactNode }
function EmptyState({ title, description, icon, action, className, ...props }: EmptyStateProps) {
  return <div className={cn("flex min-w-0 flex-col items-center gap-2 p-4 text-center [overflow-wrap:anywhere]", className)} {...props}>
    <div aria-hidden="true" className="text-fg-muted [&_svg]:size-5">{icon ?? <Inbox />}</div>
    <p className="text-body text-fg">{title}</p>{description && <p className="text-caption text-fg-muted">{description}</p>}{action}
  </div>
}
function LoadingState({ label = "Loading…", rows = 3, className, ...props }: ComponentProps<"div"> & { label?: string; rows?: number }) {
  const count = Number.isFinite(rows) ? Math.max(3, Math.min(5, Math.round(rows))) : 3
  return <div className={cn("flex min-w-0 flex-col gap-3 p-4", className)} {...props}><span className="sr-only" role="status">{label}</span><div aria-hidden="true" className="flex flex-col gap-3">{Array.from({ length: count }, (_, index) => <div key={index} className="h-4 animate-pulse rounded-sm bg-hover motion-reduce:animate-none" />)}</div></div>
}
type ErrorStateProps = { message: ReactNode; onRetry?: () => void; retrying?: boolean; className?: string }
function ErrorState({ message, onRetry, retrying, className }: ErrorStateProps) {
  return <Alert variant="destructive" className={cn("min-w-0 flex-wrap", className)}><AlertTriangle aria-hidden="true" /><p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{message}</p>{onRetry && <Button type="button" variant="outline" size="sm" className="max-md:h-11" disabled={retrying} onClick={onRetry}>{retrying ? "Retrying…" : "Retry"}</Button>}</Alert>
}
export { EmptyState, LoadingState, ErrorState, type EmptyStateProps, type ErrorStateProps }
