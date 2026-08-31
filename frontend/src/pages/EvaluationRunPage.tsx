import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  History,
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
  getEvaluationSecuritySummary,
  getEvaluationPerformanceSummary,
  getEvaluationCostSummary,
  type EvaluationCostSummary,
  type EvaluationPerformanceSummary,
  type EvaluationResult,
  type EvaluationQualitySummary,
  type EvaluationSecuritySummary,
  type QualityAggregate,
  type SecurityAggregate,
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
  const [securitySummary, setSecuritySummary] =
    useState<EvaluationSecuritySummary | null>(null)
  const [performanceSummary, setPerformanceSummary] =
    useState<EvaluationPerformanceSummary | null>(null)
  const [costSummary, setCostSummary] =
    useState<EvaluationCostSummary | null>(null)
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
        const [quality, security, performance, costs] =
          run.status === "completed" || run.status === "failed"
            ? await Promise.all([
                getEvaluationQualitySummary(id),
                getEvaluationSecuritySummary(id),
                getEvaluationPerformanceSummary(id),
                getEvaluationCostSummary(id),
              ])
            : [null, null, null, null]
        if (!active) return
        setEvaluation(run)
        setResults(page.items)
        setResultTotal(page.total)
        if (quality) setQualitySummary(quality)
        if (security) setSecuritySummary(security)
        if (performance) setPerformanceSummary(performance)
        if (costs) setCostSummary(costs)
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
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/evaluations/history"
              className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
            >
              <History className="size-4" /> History
            </Link>
            <StatusBadge status={evaluation.status} />
          </div>
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
      {securitySummary && securitySummary.overall.total_tests > 0 && (
        <SecuritySummary summary={securitySummary} />
      )}
      {performanceSummary && <PerformanceSummary summary={performanceSummary} />}
      {costSummary && <CostSummary summary={costSummary} />}

      <section className="space-y-4" aria-labelledby="results-heading">
        <div>
          <h2 id="results-heading" className="text-2xl font-semibold">
            Individual results
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Raw outputs, execution metrics, and quality scores are shown together.
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
      Dashboard
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

function PerformanceSummary({ summary }: { summary: EvaluationPerformanceSummary }) {
  const latency = summary.latency
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>
          <h2>Performance</h2>
        </CardTitle>
        <CardDescription>
          Full-response latency and normalized provider token usage. Missing values
          are excluded from aggregates.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="latency-summary-heading">
          <h3 id="latency-summary-heading" className="font-medium">
            Latency
          </h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <Metric label="Average" value={formatLatency(latency.average_ms)} />
            <Metric label="Minimum" value={formatLatency(latency.minimum_ms)} />
            <Metric label="Maximum" value={formatLatency(latency.maximum_ms)} />
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {formatAvailability(latency.recorded_results, latency.unavailable_results)}
          </p>
          <h4 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Average by model
          </h4>
          <ul className="mt-2 space-y-2 text-sm">
            {summary.latency_by_model.map((model) => (
              <li key={model.model_id} className="flex justify-between gap-3">
                <span>{model.model_name}</span>
                <span className="text-right text-muted-foreground">
                  {formatLatency(model.average_ms)} ·{" "}
                  {formatAvailability(model.recorded_results, model.unavailable_results)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="token-summary-heading">
          <h3 id="token-summary-heading" className="font-medium">
            Token usage
          </h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <AggregateMetric label="Input" aggregate={summary.input_tokens} />
            <AggregateMetric label="Output" aggregate={summary.output_tokens} />
            <AggregateMetric label="Total" aggregate={summary.total_tokens} />
          </dl>
          <h4 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total by model
          </h4>
          <ul className="mt-2 space-y-2 text-sm">
            {summary.token_usage_by_model.map((model) => (
              <li key={model.model_id} className="flex justify-between gap-3">
                <span>{model.model_name}</span>
                <span className="text-right text-muted-foreground">
                  {formatMetric(model.total_tokens.sum_tokens)} ·{" "}
                  {formatAvailability(
                    model.total_tokens.recorded_results,
                    model.total_tokens.unavailable_results,
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
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
            {result.case_type === "security" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">Security test</Badge>
                {result.security_test_type && (
                  <Badge variant="outline">
                    {securityTypeLabel(result.security_test_type)}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <ResultStatus status={result.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <TextValue label="Rendered prompt" value={result.rendered_prompt} />
          <TextValue label="Input" value={result.test_input} />
          <TextValue
            label={
              result.case_type === "security"
                ? "Failure marker"
                : "Expected output"
            }
            value={result.expected_output}
          />
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
        <dl className="grid gap-3 border-t pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Metric
            label="Latency"
            value={result.latency_ms === null ? "Unavailable" : `${result.latency_ms} ms`}
          />
          <Metric label="Input tokens" value={formatMetric(result.input_tokens)} />
          <Metric label="Output tokens" value={formatMetric(result.output_tokens)} />
          <Metric label="Max output tokens" value={result.max_output_tokens} />
          <Metric label="Total tokens" value={formatMetric(result.total_tokens)} />
          <Metric
            label="Estimated cost"
            value={formatUsd(result.estimated_cost_usd)}
          />
        </dl>
        {result.pricing && (
          <p className="text-xs text-muted-foreground">
            Estimate uses ${result.pricing.input_usd_per_million_tokens} input and
            ${result.pricing.output_usd_per_million_tokens} output per 1M tokens ·{" "}
            {result.pricing.source} · effective {result.pricing.effective_date}
            {result.pricing.source_url && (
              <> · <a className="underline" href={result.pricing.source_url} target="_blank" rel="noreferrer">source</a></>
            )}
          </p>
        )}
        {result.case_type === "security" ? (
          <div className="border-t pt-4">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Security assessment
            </h4>
            <p className="mt-2">
              <SecurityStatus status={result.security_status} />
              {result.security_metric_version !== null && (
                <span className="ml-2 text-xs text-muted-foreground">
                  Rule version {result.security_metric_version}
                </span>
              )}
            </p>
          </div>
        ) : (
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
        )}
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

function SecurityStatus({
  status,
}: {
  status: EvaluationResult["security_status"]
}) {
  if (status === "passed") {
    return <span className="font-medium text-green-800">Passed</span>
  }
  if (status === "failed") {
    return <span className="font-medium text-red-800">Failed</span>
  }
  return <span className="font-medium text-muted-foreground">Unavailable</span>
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

function AggregateMetric({
  label,
  aggregate,
}: {
  label: string
  aggregate: EvaluationPerformanceSummary["input_tokens"]
}) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{formatMetric(aggregate.sum_tokens)}</dd>
      <dd className="mt-1 text-xs text-muted-foreground">
        {formatAvailability(aggregate.recorded_results, aggregate.unavailable_results)}
      </dd>
    </div>
  )
}

function CostSummary({ summary }: { summary: EvaluationCostSummary }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle><h2>Estimated costs</h2></CardTitle>
        <CardDescription>
          USD estimates from snapshotted model rates and provider-reported token
          usage. Taxes, discounts, caching, and provider billing adjustments are
          not included.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Metric label="Evaluation total" value={formatUsd(summary.overall.estimated_usd)} />
          <Metric label="Average per complete test case" value={formatUsd(summary.average_complete_test_case_usd)} />
        </dl>
        <p className="text-xs text-muted-foreground">
          {summary.overall.priced_results} requests priced · {summary.overall.unavailable_results} unavailable · {summary.complete_test_cases} complete test cases · {summary.incomplete_test_cases} incomplete
        </p>
        <div>
          <h3 className="text-sm font-medium">By model</h3>
          <dl className="mt-2 space-y-2">
            {summary.by_model.map((model) => (
              <div key={model.model_id} className="flex justify-between gap-3 rounded-lg bg-muted p-3">
                <dt className="text-sm">{model.model_name}</dt>
                <dd className="text-right text-sm font-semibold">
                  {formatUsd(model.estimated_usd)}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {model.priced_results} priced · {model.unavailable_results} unavailable
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </CardContent>
    </Card>
  )
}

function formatLatency(value: number | null): string {
  return value === null
    ? "Unavailable"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`
}

function formatAvailability(recorded: number, unavailable: number): string {
  return `${recorded} recorded · ${unavailable} unavailable`
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

function formatUsd(value: string | null) {
  if (value === null) return "Unavailable"
  const [whole, rawFraction = ""] = value.split(".")
  const significantFraction = rawFraction.replace(/0+$/, "")
  const fraction = significantFraction.padEnd(2, "0")
  return `$${whole}.${fraction}`
}

function SecuritySummary({ summary }: { summary: EvaluationSecuritySummary }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>
          <h2>Security score</h2>
        </CardTitle>
        <CardDescription>
          Deterministic forbidden-marker checks. Unavailable executions remain
          visible and count in the denominator as not passed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-3xl font-semibold">
            {formatQualityScore(summary.overall.score)}
          </p>
          <SecurityCounts aggregate={summary.overall} />
          <p className="mt-1 text-xs text-muted-foreground">
            Rule version {summary.metric_version}
          </p>
        </div>
        <SecurityBreakdown
          title="By model"
          rows={summary.by_model.map((item) => ({
            key: item.model_id,
            label: item.model_name,
            aggregate: item,
          }))}
        />
        <SecurityBreakdown
          title="By prompt version"
          rows={summary.by_prompt_version.map((item) => ({
            key: item.prompt_version_id,
            label: `${item.prompt_name} · Version ${item.prompt_version_number}`,
            aggregate: item,
          }))}
        />
      </CardContent>
    </Card>
  )
}

function SecurityBreakdown({
  title,
  rows,
}: {
  title: string
  rows: Array<{ key: string; label: string; aggregate: SecurityAggregate }>
}) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      <dl className="mt-2 space-y-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-start justify-between gap-4 rounded-lg bg-muted p-3"
          >
            <dt className="text-sm">{row.label}</dt>
            <dd className="text-right text-sm font-semibold">
              {formatQualityScore(row.aggregate.score)}
              <SecurityCounts aggregate={row.aggregate} compact />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SecurityCounts({
  aggregate,
  compact = false,
}: {
  aggregate: SecurityAggregate
  compact?: boolean
}) {
  return (
    <span
      className={`${compact ? "block" : "mt-1 block"} text-xs font-normal text-muted-foreground`}
    >
      {aggregate.passed_tests} passed · {aggregate.failed_tests} failed ·{" "}
      {aggregate.unavailable_tests} unavailable · {aggregate.total_tests} total
    </span>
  )
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

function securityTypeLabel(value: string) {
  return value.replaceAll("_", " ")
}

function formatQualityScore(value: number | null) {
  if (value === null) return "Unavailable"
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value)
}
