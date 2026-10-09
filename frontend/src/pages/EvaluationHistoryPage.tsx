import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FlaskConical,
  History,
  Layers3,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import {
  getPastEvaluations,
  type EvaluationRunHistory,
  type EvaluationRunPage,
} from "@/api/evaluations"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 20

export function EvaluationHistoryPage() {
  const [runs, setRuns] = useState<EvaluationRunHistory[]>([])
  const [page, setPage] = useState<EvaluationRunPage | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    getPastEvaluations(0, PAGE_SIZE)
      .then((result) => {
        if (!active) return
        setRuns(result.items)
        setPage(result)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [retryKey])

  async function loadMore() {
    if (!page || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const next = await getPastEvaluations(runs.length, PAGE_SIZE)
      setRuns((current) => [...current, ...next.items])
      setPage(next)
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setIsLoadingMore(false)
    }
  }

  return (
    <div className="space-y-8">
      <header className="relative overflow-hidden rounded-2xl border bg-card px-6 py-8 sm:px-8">
        <div className="absolute right-0 top-0 h-full w-1/2 bg-gradient-to-l from-brand-soft to-transparent" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand-strong">
              <History className="size-4" /> Persistent archive
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Evaluation history
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Reopen immutable runs with the exact models, prompt versions, and
              result counts used at execution time.
            </p>
          </div>
          <Link
            to="/evaluations/new"
            className={cn(buttonVariants(), "w-fit")}
          >
            <FlaskConical className="size-4" /> New evaluation
          </Link>
        </div>
      </header>

      {page && <ArchiveSummary page={page} />}
      {isLoading && (
        <p className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" /> Loading history…
        </p>
      )}
      {error && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-destructive" role="alert">
          <span>{error}</span>
          <Button type="button" onClick={() => setRetryKey((value) => value + 1)}>
            <RefreshCw className="size-4" /> Retry
          </Button>
        </div>
      )}
      {!isLoading && !error && runs.length === 0 && <EmptyHistory />}

      <ol className="relative space-y-4 before:absolute before:bottom-6 before:left-[1.2rem] before:top-6 before:w-px before:bg-border sm:before:left-[7.45rem]">
        {runs.map((run) => (
          <HistoryItem key={run.id} run={run} />
        ))}
      </ol>

      {page && runs.length < page.total && (
        <Button type="button" disabled={isLoadingMore} onClick={loadMore}>
          {isLoadingMore && <LoaderCircle className="size-4 animate-spin" />}
          {isLoadingMore ? "Loading…" : "Load older evaluations"}
        </Button>
      )}
    </div>
  )
}

function ArchiveSummary({ page }: { page: EvaluationRunPage }) {
  const active = page.total - page.completed - page.failed
  return (
    <dl className="grid gap-3 sm:grid-cols-4">
      <Summary label="Saved runs" value={page.total} />
      <Summary label="Completed" value={page.completed} />
      <Summary label="Failed" value={page.failed} />
      <Summary label="Active" value={active} />
    </dl>
  )
}

function HistoryItem({ run }: { run: EvaluationRunHistory }) {
  return (
    <li className="relative grid gap-3 pl-12 sm:grid-cols-[6.5rem_1fr] sm:gap-8 sm:pl-0">
      <div className="pt-5 text-xs text-muted-foreground sm:text-right">
        <span className="block font-medium text-foreground">
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
            new Date(run.created_at),
          )}
        </span>
        <span>
          {new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
            new Date(run.created_at),
          )}
        </span>
      </div>
      <span className="absolute left-3 top-7 z-10 flex size-5 items-center justify-center rounded-full border bg-background sm:left-[6.85rem]">
        <span className="size-2 rounded-full bg-brand" />
      </span>
      <Card className="gap-4 py-5 transition-shadow hover:shadow-md">
        <CardContent className="space-y-5 px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Run {run.id.slice(0, 8)}
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {run.dataset_name} evaluation
              </h2>
            </div>
            <StatusBadge status={run.status} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SnapshotList
              label="Models"
              values={run.models.map((model) => model.name)}
            />
            <SnapshotList
              label="Prompt versions"
              values={run.prompt_versions.map(
                (prompt) => `${prompt.name} · v${prompt.version_number}`,
              )}
            />
          </div>

          <div className="flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <ResultCount label="Requests" value={run.total_requests} />
              <ResultCount label="Successful" value={run.successful_requests} />
              <ResultCount label="Failed" value={run.failed_requests} />
            </dl>
            <div className="flex flex-wrap gap-2">
              {(run.status === "completed" || run.status === "failed") && (
                <Link
                  to={`/?run=${run.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Compare models
                </Link>
              )}
              <Link
                to={`/evaluations/${run.id}`}
                className={buttonVariants({ size: "sm" })}
              >
                Open results <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </li>
  )
}

function SnapshotList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Layers3 className="size-3.5" /> {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {values.length > 0 ? (
          values.map((value) => <Badge key={value} variant="secondary">{value}</Badge>)
        ) : (
          <span className="text-sm text-muted-foreground">Unavailable for this historical run</span>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: EvaluationRunHistory["status"] }) {
  const Icon =
    status === "completed"
      ? CheckCircle2
      : status === "failed"
        ? XCircle
        : status === "running"
          ? LoaderCircle
          : Clock3
  return (
    <Badge variant="outline" className="gap-1.5">
      <Icon className={`size-3.5 ${status === "running" ? "animate-spin" : ""}`} />
      {status[0].toUpperCase() + status.slice(1)}
    </Badge>
  )
}

function ResultCount({ label, value }: { label: string; value: number }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold">{value.toLocaleString()}</dd></div>
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border bg-card p-4"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</dd></div>
}

function EmptyHistory() {
  return (
    <Card className="items-center py-14 text-center">
      <CardContent>
        <History className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-semibold">No evaluations yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Create a run to start the persistent history.</p>
      </CardContent>
    </Card>
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load evaluation history."
}
