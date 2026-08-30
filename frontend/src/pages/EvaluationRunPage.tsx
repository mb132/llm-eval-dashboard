import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"

import {
  getEvaluationResults,
  getEvaluationRun,
  getEvaluationQualitySummary,
  type EvaluationResult,
  type EvaluationQualitySummary,
  type QualityAggregate,
  type EvaluationRun,
  type EvaluationRunStatus,
} from "@/api/evaluations"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const POLL_INTERVAL_MS = 1_500
const RESULT_PAGE_SIZE = 50

export function EvaluationRunPage() {
  const { evaluationId } = useParams()
  const [evaluation, setEvaluation] = useState<EvaluationRun | null>(null)
  const [results, setResults] = useState<EvaluationResult[]>([])
  const [resultTotal, setResultTotal] = useState(0)
  const [qualitySummary, setQualitySummary] =
    useState<EvaluationQualitySummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    const id = evaluationId ?? ""
    if (!id) {
      setError("Evaluation not found.")
      setIsLoading(false)
      return
    }
    let active = true
    let timeoutId: number | undefined

    async function poll() {
      try {
        const [run, page] = await Promise.all([
          getEvaluationRun(id),
          getEvaluationResults(id, 0, RESULT_PAGE_SIZE),
        ])
        const quality =
          run.status === "completed" || run.status === "failed"
            ? await getEvaluationQualitySummary(id)
            : null
        if (!active) return
        setEvaluation(run)
        setResults(page.items)
        setResultTotal(page.total)
        if (quality) setQualitySummary(quality)
        setError(null)
        if (run.status === "pending" || run.status === "running") {
          timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS)
        }
      } catch (caughtError) {
        if (!active) return
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Could not load the evaluation.",
        )
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void poll()
    return () => {
      active = false
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [evaluationId, retryKey])

  async function loadMore() {
    if (!evaluationId || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const page = await getEvaluationResults(
        evaluationId,
        results.length,
        RESULT_PAGE_SIZE,
      )
      setResults((current) => [...current, ...page.items])
      setResultTotal(page.total)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not load more results.",
      )
    } finally {
      setIsLoadingMore(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading evaluation…
      </div>
    )
  }

  if (error && !evaluation) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <BackLink />
        <ErrorMessage message={error} />
        <Button type="button" onClick={() => setRetryKey((value) => value + 1)}>
          <RefreshCw className="mr-2 size-4" />
          Retry
        </Button>
      </div>
    )
  }

  if (!evaluation) return null

  const isActive = evaluation.status === "pending" || evaluation.status === "running"
  const progress = Math.round(
    (evaluation.completed_requests / evaluation.total_requests) * 100,
  )

  return (
    <div className="space-y-7">
      <header className="space-y-4">
        <BackLink />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Evaluation run
            </h1>
            <p className="mt-2 text-muted-foreground">
              {evaluation.dataset_name} · {evaluation.total_requests} model requests
            </p>
          </div>
          <StatusBadge status={evaluation.status} />
        </div>
      </header>

      <Card className="shadow-sm" aria-live="polite">
        <CardHeader>
          <CardTitle>
            <h2>Progress</h2>
          </CardTitle>
          <CardDescription>
            {isActive
              ? "The evaluation continues in the background."
              : "The persisted run can be reopened at this URL."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span>{evaluation.completed_requests} completed</span>
              <span>{progress}%</span>
            </div>
            <progress
              className="h-3 w-full overflow-hidden rounded-full accent-foreground"
              value={evaluation.completed_requests}
              max={evaluation.total_requests}
              aria-label="Evaluation progress"
            />
          </div>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Metric label="Successful" value={evaluation.successful_requests} />
            <Metric label="Failed requests" value={evaluation.failed_requests} />
            <Metric label="Total" value={evaluation.total_requests} />
          </dl>
          {evaluation.failure_message && (
            <ErrorMessage message={evaluation.failure_message} />
          )}
        </CardContent>
      </Card>

      {qualitySummary && <QualitySummary summary={qualitySummary} />}

      <section className="space-y-4" aria-labelledby="results-heading">
        <div>
          <h2 id="results-heading" className="text-2xl font-semibold">
            Individual results
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Raw outputs and deterministic quality scores are shown together.
          </p>
        </div>
        {error && (
          <div className="flex flex-wrap items-center gap-3">
            <ErrorMessage message={error} />
            <Button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
            >
              <RefreshCw className="mr-2 size-4" />
              Retry
            </Button>
          </div>
        )}
        <div className="space-y-4">
          {results.map((result) => (
            <ResultCard key={result.id} result={result} />
          ))}
        </div>
        {results.length < resultTotal && !isActive && (
          <Button type="button" disabled={isLoadingMore} onClick={loadMore}>
            {isLoadingMore && <LoaderCircle className="mr-2 size-4 animate-spin" />}
            {isLoadingMore ? "Loading…" : "Load more results"}
          </Button>
        )}
      </section>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
    >
      <ArrowLeft className="size-4" />
      New evaluation
    </Link>
  )
}

function StatusBadge({ status }: { status: EvaluationRunStatus }) {
  const labels: Record<EvaluationRunStatus, string> = {
    pending: "Pending",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
  }
  const Icon =
    status === "completed"
      ? CheckCircle2
      : status === "failed"
        ? XCircle
        : status === "running"
          ? LoaderCircle
          : Clock3
  return (
    <Badge variant="outline" className="gap-2 px-3 py-1.5">
      <Icon className={`size-4 ${status === "running" ? "animate-spin" : ""}`} />
      {labels[status]}
    </Badge>
  )
}

function ResultCard({ result }: { result: EvaluationResult }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>
              <h3>{result.model_name}</h3>
            </CardTitle>
            <CardDescription className="mt-1">
              {result.prompt_name} · Version {result.prompt_version_number} ·
              Repetition {result.repetition}
            </CardDescription>
          </div>
          <ResultStatus status={result.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <TextValue label="Input" value={result.test_input} />
          <TextValue label="Expected output" value={result.expected_output} />
        </div>
        {result.status === "succeeded" && (
          <TextValue
            label="Generated output"
            value={result.generated_output ?? "No output returned."}
            emphasized
          />
        )}
        {result.status === "failed" && (
          <ErrorMessage message={result.error_message ?? "Model request failed."} />
        )}
        {result.status === "running" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Waiting for the model response…
          </p>
        )}
        {result.status === "pending" && (
          <p className="text-sm text-muted-foreground">Waiting to be processed…</p>
        )}
        <dl className="grid gap-3 border-t pt-4 sm:grid-cols-3">
          <Metric
            label="Latency"
            value={result.latency_ms === null ? "Unavailable" : `${result.latency_ms} ms`}
          />
          <Metric label="Input tokens" value={formatMetric(result.input_tokens)} />
          <Metric label="Output tokens" value={formatMetric(result.output_tokens)} />
        </dl>
        <div className="border-t pt-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Quality
          </h4>
          {result.quality_scores.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Quality scores unavailable for this historical result.
            </p>
          ) : (
            <dl className="mt-2 grid gap-3 sm:grid-cols-2">
              {result.quality_scores.map((quality) => (
                <Metric
                  key={`${quality.method}-${quality.version}`}
                  label={`${qualityMetricLabel(quality.method)} v${quality.version}`}
                  value={formatQualityScore(quality.score)}
                />
              ))}
            </dl>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ResultStatus({ status }: { status: EvaluationResult["status"] }) {
  if (status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-green-800">
        <CheckCircle2 className="size-4" /> Success
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-red-800">
        <XCircle className="size-4" /> Failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      {status === "running" ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : (
        <Clock3 className="size-4" />
      )}
      {status === "running" ? "Running" : "Pending"}
    </span>
  )
}

function TextValue({
  label,
  value,
  emphasized = false,
}: {
  label: string
  value: string
  emphasized?: boolean
}) {
  return (
    <div>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <p
        className={`mt-2 whitespace-pre-wrap break-words rounded-lg p-3 text-sm ${
          emphasized ? "bg-green-50" : "bg-muted"
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  )
}

function formatMetric(value: number | null) {
  return value === null ? "Unavailable" : value.toLocaleString()
}

function QualitySummary({ summary }: { summary: EvaluationQualitySummary }) {
  return (
    <section className="space-y-4" aria-labelledby="quality-heading">
      <div>
        <h2 id="quality-heading" className="text-2xl font-semibold">
          Response quality
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deterministic normalized matching. Pending and failed requests are
          excluded from averages and shown as unavailable.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {summary.metrics.map((metric) => (
          <Card key={`${metric.method}-${metric.version}`} className="shadow-sm">
            <CardHeader>
              <CardTitle>
                <h3>{qualityMetricLabel(metric.method)}</h3>
              </CardTitle>
              <CardDescription>Metric version {metric.version}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <p className="text-3xl font-semibold">
                  {formatQualityScore(metric.overall.average_score)}
                </p>
                <SampleCounts aggregate={metric.overall} />
              </div>
              <QualityBreakdown
                title="By model"
                rows={metric.by_model.map((item) => ({
                  key: item.model_id,
                  label: item.model_name,
                  aggregate: item,
                }))}
              />
              <QualityBreakdown
                title="By prompt version"
                rows={metric.by_prompt_version.map((item) => ({
                  key: item.prompt_version_id,
                  label: `${item.prompt_name} · Version ${item.prompt_version_number}`,
                  aggregate: item,
                }))}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

function QualityBreakdown({
  title,
  rows,
}: {
  title: string
  rows: Array<{ key: string; label: string; aggregate: QualityAggregate }>
}) {
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <dl className="mt-2 space-y-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-start justify-between gap-4 rounded-lg bg-muted p-3"
          >
            <dt className="text-sm">{row.label}</dt>
            <dd className="text-right text-sm font-semibold">
              {formatQualityScore(row.aggregate.average_score)}
              <SampleCounts aggregate={row.aggregate} compact />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SampleCounts({
  aggregate,
  compact = false,
}: {
  aggregate: QualityAggregate
  compact?: boolean
}) {
  return (
    <span
      className={`${compact ? "block" : "mt-1 block"} text-xs font-normal text-muted-foreground`}
    >
      {aggregate.scored_results} scored · {aggregate.unavailable_results} unavailable
    </span>
  )
}

function qualityMetricLabel(method: string) {
  const labels: Record<string, string> = {
    normalized_exact_match: "Normalized exact match",
    normalized_contains_match: "Normalized contains match",
  }
  return labels[method] ?? method
}

function formatQualityScore(value: number | null) {
  if (value === null) return "Unavailable"
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value)
}
