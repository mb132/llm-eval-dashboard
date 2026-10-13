import { AlertCircle, ChevronDown, ChevronRight, Download } from "lucide-react"
import { Fragment, useEffect, useId, useRef, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"

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
  type EvaluationResultFilterOptions,
  type EvaluationResultFilters,
  type EvaluationQualitySummary,
  type EvaluationSecuritySummary,
  type QualityAggregate,
  type SecurityAggregate,
  type EvaluationRun,
  type EvaluationRunStatus,
} from "@/api/evaluations"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { download } from "@/lib/download"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InsetPane, ResultPanes } from "@/components/ui/inset-pane"
import { MetricCell, MetricStrip } from "@/components/ui/metric-strip"
import { MeterBar, SplitBar } from "@/components/ui/meter"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  formatDateTime,
  formatInt,
  formatMs,
  formatPercent,
  formatPricePerMillion,
  formatTokens,
  formatUsd as usd,
} from "@/lib/format"

const POLL_INTERVAL_MS = 1_500
const RESULT_PAGE_SIZE = 50

export function EvaluationRunPage() {
  const { evaluationId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [evaluation, setEvaluation] = useState<EvaluationRun | null>(null)
  const [results, setResults] = useState<EvaluationResult[]>([])
  const [resultTotal, setResultTotal] = useState(0)
  const [unfilteredResultTotal, setUnfilteredResultTotal] = useState(0)
  const [filterOptions, setFilterOptions] =
    useState<EvaluationResultFilterOptions | null>(null)
  const [qualitySummary, setQualitySummary] =
    useState<EvaluationQualitySummary | null>(null)
  const [securitySummary, setSecuritySummary] =
    useState<EvaluationSecuritySummary | null>(null)
  const [performanceSummary, setPerformanceSummary] =
    useState<EvaluationPerformanceSummary | null>(null)
  const [costSummary, setCostSummary] = useState<EvaluationCostSummary | null>(
    null,
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [search, setSearch] = useState("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [summaryOpen, setSummaryOpen] = useState(false)
  const filters = filtersFromSearchParams(searchParams)
  const filterKey = searchParams.toString()
  const requestScope = useRef("")
  requestScope.current = `${evaluationId}?${filterKey}:${retryKey}`

  useEffect(() => {
    setIsLoading(true)
    setEvaluation(null)
    setResults([])
    setFilterOptions(null)
    setQualitySummary(null)
    setSecuritySummary(null)
    setPerformanceSummary(null)
    setCostSummary(null)
    setExpanded(new Set())
    setSearch("")
    setError(null)
  }, [evaluationId])

  useEffect(() => {
    const id = evaluationId ?? ""
    if (!id) {
      setError("Evaluation not found.")
      setIsLoading(false)
      return
    }
    let active = true
    let timeoutId: number | undefined
    setIsLoadingMore(false)

    async function poll() {
      try {
        const [run, page] = await Promise.all([
          getEvaluationRun(id),
          getEvaluationResults(id, 0, RESULT_PAGE_SIZE, filters),
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
        setUnfilteredResultTotal(page.unfiltered_total ?? page.total)
        setFilterOptions(page.filter_options ?? null)
        setQualitySummary(quality)
        setSecuritySummary(security)
        setPerformanceSummary(performance)
        setCostSummary(costs)
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
  }, [evaluationId, filterKey, retryKey])

  async function loadMore() {
    if (!evaluationId || isLoadingMore) return
    const scope = requestScope.current
    setIsLoadingMore(true)
    try {
      const page = await getEvaluationResults(
        evaluationId,
        results.length,
        RESULT_PAGE_SIZE,
        filters,
      )
      if (scope !== requestScope.current) return
      setResults((current) => [...current, ...page.items])
      setResultTotal(page.total)
      setUnfilteredResultTotal(page.unfiltered_total ?? page.total)
      setFilterOptions(page.filter_options ?? null)
    } catch (caughtError) {
      if (scope !== requestScope.current) return
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not load more results.",
      )
    } finally {
      if (scope === requestScope.current) setIsLoadingMore(false)
    }
  }

  const id8 = (evaluationId ?? "").slice(0, 8).toLowerCase()
  const active =
    evaluation?.status === "pending" || evaluation?.status === "running"
  const terminal =
    evaluation?.status === "completed" || evaluation?.status === "failed"
  const pending = Math.max(
    0,
    (evaluation?.total_requests ?? 0) - (evaluation?.completed_requests ?? 0),
  )
  const contains = qualitySummary?.metrics.find(
    (metric) =>
      metric.method === "normalized_contains_match" && metric.version === 1,
  )
  const exact = qualitySummary?.metrics.find(
    (metric) =>
      metric.method === "normalized_exact_match" && metric.version === 1,
  )
  const visible = results.filter((row) =>
    [row.test_input, row.expected_output, row.generated_output ?? ""].some(
      (text) => text.toLowerCase().includes(search.toLowerCase()),
    ),
  )
  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function clearFilters() {
    setSearchParams(new URLSearchParams())
    setSearch("")
  }
  const actions = (
    <>
      <Link
        to={`/?run=${evaluationId}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Compare on dashboard
      </Link>
      {terminal &&
        ["json", "csv"].map((format) => (
          <Button
            key={format}
            variant="outline"
            size="sm"
            onClick={() =>
              void download(
                `/api/evaluations/${evaluationId}/export?${searchParams.toString()}&format=${format}`,
                `evaluation-results.${format}`,
              )
            }
          >
            <Download className="size-3.5" aria-hidden="true" />
            {format === "json" ? "Export JSON" : "CSV"}
          </Button>
        ))}
    </>
  )
  const filterControls = (
    <ResultFiltersPanel
      options={filterOptions}
      filters={filters}
      onChange={(next) => setSearchParams(searchParamsFromFilters(next))}
      onClear={clearFilters}
      search={search}
    />
  )
  return (
    <PageFrame
      breadcrumbs={[
        { label: "Runs", to: "/evaluations/history" },
        { label: id8, title: evaluationId },
      ]}
      actions={actions}
      mobileTitle="Runs"
      mobileBack={{ label: `Runs / ${id8}`, to: "/evaluations/history" }}
    >
      {isLoading ? (
        <>
          <PageHeader title="Evaluation" />
          <Card>
            <LoadingState label="Loading evaluation…" />
          </Card>
        </>
      ) : !evaluation ? (
        <>
          <PageHeader title="Evaluation" />
          <ErrorState
            message={error ?? "Evaluation not found."}
            onRetry={() => setRetryKey((value) => value + 1)}
          />
        </>
      ) : (
        <>
          <PageHeader
            title={`${evaluation.dataset_name} evaluation`}
            accessory={<StatusBadge status={evaluation.status} />}
            metadata={
              <>
                <span title={evaluation.id} className="font-mono">
                  Run {id8}
                </span>
                <span>{formatDateTime(evaluation.created_at)}</span>
                <span>Dataset {evaluation.dataset_name}</span>
                <span>
                  Models{" "}
                  {filterOptions?.models.map((item) => item.name).join(", ") ||
                    "—"}
                </span>
                <span>
                  Prompts{" "}
                  {filterOptions?.prompt_versions
                    .map((item) => `${item.name} · v${item.version_number}`)
                    .join(", ") || "—"}
                </span>
                <span>Repetitions {formatInt(evaluation.repetitions)}</span>
              </>
            }
          />
          {evaluation.failure_message && (
            <ErrorMessage message={evaluation.failure_message} />
          )}
          <div className="grid grid-cols-3 gap-2 md:hidden">
            {terminal &&
              ["json", "csv"].map((format) => (
                <Button
                  key={format}
                  variant="outline"
                  className="h-11"
                  onClick={() =>
                    void download(
                      `/api/evaluations/${evaluationId}/export?${searchParams.toString()}&format=${format}`,
                      `evaluation-results.${format}`,
                    )
                  }
                >
                  {format.toUpperCase()}
                </Button>
              ))}
            <Link
              to={`/?run=${evaluationId}`}
              className={buttonVariants({
                variant: "outline",
                className: "h-11",
              })}
            >
              Compare
            </Link>
          </div>
          <Card aria-label="Progress" aria-live="polite">
            <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-3 py-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-metric-md">
                  {formatInt(evaluation.completed_requests)}/
                  {formatInt(evaluation.total_requests)}
                </span>
                <span className="text-caption text-fg-muted">
                  requests finished
                </span>
              </div>
              <SplitBar
                role="progressbar"
                aria-label="Evaluation progress"
                className="min-w-32 flex-1"
                value={
                  evaluation.total_requests
                    ? evaluation.completed_requests / evaluation.total_requests
                    : 0
                }
                segments={[
                  { value: evaluation.successful_requests, tone: "success" },
                  { value: evaluation.failed_requests, tone: "destructive" },
                  { value: pending, tone: "line" },
                ]}
              />
              <div className="flex flex-wrap gap-3 font-mono text-data">
                <span className="text-success">
                  ✓ {formatInt(evaluation.successful_requests)} succeeded
                </span>
                <span className="text-destructive">
                  ✕ {formatInt(evaluation.failed_requests)} failed
                </span>
                <span className="text-fg-muted">
                  {formatInt(pending)} pending
                </span>
              </div>
            </CardContent>
          </Card>
          <MetricStrip aria-label="Run summary">
            <MetricCell
              label="Quality · contains"
              value={formatPercent(contains?.overall.average_score)}
              visual={
                contains?.overall.average_score != null && (
                  <MeterBar
                    value={contains.overall.average_score}
                    aria-label="Contains score"
                  />
                )
              }
              subValue={`exact ${formatPercent(exact?.overall.average_score)} · ${formatInt(contains?.overall.scored_results)} scored · ${formatInt(contains?.overall.unavailable_results)} n/a`}
            />
            <MetricCell
              label="Security"
              value={formatPercent(securitySummary?.overall.score)}
              subValue={
                securitySummary?.overall.total_tests
                  ? `${securitySummary.overall.passed_tests}/${securitySummary.overall.total_tests} passed · ${securitySummary.overall.unavailable_tests} unavailable`
                  : active
                    ? "Assessment pending"
                    : "No security cases in dataset"
              }
            />
            <MetricCell
              label="Avg latency"
              value={formatMs(performanceSummary?.latency.average_ms).replace(
                / ms$/,
                "",
              )}
              unit="ms"
              subValue={`min ${formatMs(performanceSummary?.latency.minimum_ms)} · max ${formatMs(performanceSummary?.latency.maximum_ms)}`}
            />
            <MetricCell
              label="Tokens"
              value={formatTokens(performanceSummary?.total_tokens.sum_tokens)}
              subValue={
                <>
                  {`in ${formatTokens(performanceSummary?.input_tokens.sum_tokens)} · out ${formatTokens(performanceSummary?.output_tokens.sum_tokens)}`}
                  <br />
                  {formatInt(
                    performanceSummary?.total_tokens.recorded_results,
                  )}{" "}
                  recorded ·{" "}
                  {formatInt(
                    performanceSummary?.total_tokens.unavailable_results,
                  )}{" "}
                  unavailable
                </>
              }
            />
            <MetricCell
              label="Est. cost"
              className="col-span-2 md:col-span-1"
              value={
                costSummary?.overall.estimated_usd != null ? (
                  <>
                    <span className="text-[16px] text-fg-muted">$</span>
                    {usd(costSummary.overall.estimated_usd).slice(1)}
                  </>
                ) : (
                  "—"
                )
              }
              subValue={
                <>
                  {formatInt(costSummary?.overall.unavailable_results)} unpriced
                  ·{" "}
                  <Link
                    className={buttonVariants({
                      variant: "link",
                      size: "xs",
                      className: "max-md:h-11 md:h-auto",
                    })}
                    to="/models"
                  >
                    Add pricing
                  </Link>
                </>
              }
            />
          </MetricStrip>
          <Breakdown
            results={results}
            partial={
              results.length < unfilteredResultTotal || Boolean(filterKey)
            }
          />
          <Card>
            <CardHeader>
              <CardTitle>Results</CardTitle>
              <span className="font-mono text-data text-fg-muted">
                {formatInt(visible.length)} of{" "}
                {formatInt(unfilteredResultTotal)}
              </span>
            </CardHeader>
            <div className="flex flex-wrap gap-3 border-b border-line bg-chrome p-3">
              <label className="min-w-0 flex-1 text-caption text-fg-muted md:w-44 md:flex-none">
                Search results
                <Input
                  type="search"
                  placeholder="Search text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="max-md:h-11"
                />
              </label>
              <Button
                variant="outline"
                className="h-11 self-end md:hidden"
                aria-haspopup="dialog"
                onClick={() => setFiltersOpen(true)}
              >
                Filters
              </Button>
              <div className="hidden min-w-0 md:block md:flex-1">
                {filterControls}
              </div>
            </div>
            {error && (
              <CardContent>
                <ErrorState
                  message={error}
                  onRetry={() => setRetryKey((value) => value + 1)}
                />
              </CardContent>
            )}
            <div className="hidden md:block">
              <Table
                aria-label="Results"
                className="min-w-[1000px] table-fixed"
              >
                <colgroup>
                  <col className="w-12" />
                  <col className="w-32" />
                  <col className="w-60" />
                  <col className="w-36" />
                  <col className="w-36" />
                  <col className="w-32" />
                  <col className="w-24" />
                  <col className="w-20" />
                  <col className="w-24" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    {[
                      "",
                      "Outcome",
                      "Input",
                      "Category",
                      "Model",
                      "Prompt",
                      "Latency",
                      "Tokens",
                      "Est. cost",
                    ].map((label, index) => (
                      <TableHead
                        key={index}
                        className={index > 5 ? "text-right" : undefined}
                      >
                        {label || <span className="sr-only">Expand</span>}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <Fragment key={row.id}>
                      <TableRow selected={expanded.has(row.id)}>
                        <TableCell className="[overflow-wrap:anywhere]">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Result ${row.sequence_number}: ${row.test_input}`}
                            aria-expanded={expanded.has(row.id)}
                            aria-controls={`desktop-result-${row.id}`}
                            onClick={() => toggle(row.id)}
                          >
                            {expanded.has(row.id) ? (
                              <ChevronDown
                                className="size-4"
                                aria-hidden="true"
                              />
                            ) : (
                              <ChevronRight
                                className="size-4"
                                aria-hidden="true"
                              />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="[overflow-wrap:anywhere]">
                          <Outcome result={row} />
                        </TableCell>
                        <TableCell className="max-w-72">
                          <div
                            className="truncate text-body"
                            title={row.test_input}
                          >
                            {row.test_input}
                          </div>
                          {row.status === "failed" && (
                            <RequestError result={row} />
                          )}
                        </TableCell>
                        <TableCell className="[overflow-wrap:anywhere]">
                          <span className="font-mono">
                            {row.test_category ?? "Uncategorized"}
                          </span>
                          <div className="text-data-sm text-fg-muted">
                            {row.case_type} · rep {row.repetition}
                          </div>
                        </TableCell>
                        <TableCell className="[overflow-wrap:anywhere]">
                          <ModelName result={row} />
                        </TableCell>
                        <TableCell className="[overflow-wrap:anywhere]">
                          {row.prompt_name}
                          <div className="font-mono text-data-sm text-fg-muted">
                            v{row.prompt_version_number}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMs(row.latency_ms)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatTokens(row.total_tokens)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          <ResultCost result={row} />
                        </TableCell>
                      </TableRow>
                      <TableRow hidden={!expanded.has(row.id)} selected>
                        <TableCell colSpan={9}>
                          <div id={`desktop-result-${row.id}`}>
                            {expanded.has(row.id) && (
                              <ResultDetails result={row} />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="md:hidden">
              {visible.map((row) => (
                <div key={row.id} className="border-b border-line">
                  <button
                    className="flex min-w-0 w-full flex-col gap-2 p-3 text-left focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`Result ${row.sequence_number}: ${row.test_input}`}
                    aria-expanded={expanded.has(row.id)}
                    aria-controls={`mobile-result-${row.id}`}
                    onClick={() => toggle(row.id)}
                  >
                    <span className="flex w-full items-center gap-2">
                      <Outcome result={row} />
                      <span className="min-w-0 flex-1 truncate font-mono text-data">
                        {row.test_category ?? "Uncategorized"}
                      </span>
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </span>
                    <span className="line-clamp-2 text-body [overflow-wrap:anywhere]">
                      {row.test_input}
                    </span>
                    <span className="font-mono text-data-sm text-fg-muted [overflow-wrap:anywhere]">
                      {row.model_name} · v{row.prompt_version_number} ·{" "}
                      {formatMs(row.latency_ms)} ·{" "}
                      {formatTokens(row.total_tokens)} tok
                    </span>
                  </button>
                  {row.status === "failed" && (
                    <div className="px-3 pb-3">
                      <RequestError result={row} />
                    </div>
                  )}
                  <div
                    id={`mobile-result-${row.id}`}
                    hidden={!expanded.has(row.id)}
                    className="bg-selected p-3"
                  >
                    {expanded.has(row.id) && <ResultDetails result={row} />}
                  </div>
                </div>
              ))}
            </div>
            {!visible.length && !error && (
              <EmptyState
                title="No results match these filters"
                action={
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            )}
            <CardFooter className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Standard cases are scored by contains match; security cases by
                the stored security assessment.
              </span>
              {results.length < resultTotal && !active && (
                <Button
                  variant="outline"
                  className="max-md:h-11"
                  disabled={isLoadingMore}
                  onClick={loadMore}
                >
                  {isLoadingMore
                    ? "Loading…"
                    : `Load ${Math.min(RESULT_PAGE_SIZE, resultTotal - results.length)} more`}
                </Button>
              )}
            </CardFooter>
          </Card>
          <Dialog
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            title="Filter results"
            footer={
              <Button className="max-md:h-11" onClick={() => setFiltersOpen(false)}>
                Show results
              </Button>
            }
          >
            {filterControls}
          </Dialog>
          {terminal && (
            <Card>
              <CardHeader>
                <Button
                  variant="ghost"
                  className="max-md:h-11 max-md:w-full max-md:justify-start"
                  aria-expanded={summaryOpen}
                  aria-controls="summary-details"
                  onClick={() => setSummaryOpen(!summaryOpen)}
                >
                  Summary details
                </Button>
              </CardHeader>
              <div id="summary-details" hidden={!summaryOpen}>
                {summaryOpen && (
                  <CardContent className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
                    {qualitySummary && (
                      <QualitySummary summary={qualitySummary} />
                    )}
                    {securitySummary && (
                      <SecuritySummary summary={securitySummary} />
                    )}
                    {performanceSummary && (
                      <PerformanceSummary summary={performanceSummary} />
                    )}
                    {costSummary && <CostSummary summary={costSummary} />}
                  </CardContent>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </PageFrame>
  )
}
function filtersFromSearchParams(
  searchParams: URLSearchParams,
): EvaluationResultFilters {
  const outcome = searchParams.get("outcome")
  const caseType = searchParams.get("case_type")
  return {
    modelIds: searchParams.getAll("model_id"),
    promptVersionIds: searchParams.getAll("prompt_version_id"),
    categories: searchParams.getAll("category"),
    includeUncategorized: searchParams.get("uncategorized") === "true",
    outcome:
      outcome === "passed" || outcome === "failed" || outcome === "unavailable"
        ? outcome
        : undefined,
    caseType:
      caseType === "standard" || caseType === "security" ? caseType : undefined,
  }
}

function searchParamsFromFilters(
  filters: EvaluationResultFilters,
): URLSearchParams {
  const searchParams = new URLSearchParams()
  filters.modelIds?.forEach((value) => searchParams.append("model_id", value))
  filters.promptVersionIds?.forEach((value) =>
    searchParams.append("prompt_version_id", value),
  )
  filters.categories?.forEach((value) => searchParams.append("category", value))
  if (filters.includeUncategorized) searchParams.set("uncategorized", "true")
  if (filters.outcome) searchParams.set("outcome", filters.outcome)
  if (filters.caseType) searchParams.set("case_type", filters.caseType)
  return searchParams
}

function ResultFiltersPanel({
  options,
  filters,
  onChange,
  onClear,
  search,
}: {
  options: EvaluationResultFilterOptions | null
  filters: EvaluationResultFilters
  onChange: (filters: EvaluationResultFilters) => void
  onClear: () => void
  search: string
}) {
  const hasFilters = Boolean(
    filters.modelIds?.length ||
    filters.promptVersionIds?.length ||
    filters.categories?.length ||
    filters.includeUncategorized ||
    filters.outcome ||
    filters.caseType,
  )
  return (
    <div className="grid min-w-0 grid-cols-1 items-end gap-3 md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
      <FilterSelect
        label="Model"
        values={filters.modelIds ?? []}
        options={
          options?.models.map((item) => ({
            value: item.id,
            label: item.name,
          })) ?? []
        }
        onChange={(value) =>
          onChange({ ...filters, modelIds: value ? [value] : [] })
        }
      />
      <FilterSelect
        label="Prompt version"
        values={filters.promptVersionIds ?? []}
        options={
          options?.prompt_versions.map((item) => ({
            value: item.id,
            label: `${item.name} · v${item.version_number}`,
          })) ?? []
        }
        onChange={(value) =>
          onChange({ ...filters, promptVersionIds: value ? [value] : [] })
        }
      />
      <FilterSelect
        label="Category"
        values={[
          ...(filters.categories ?? []).map((value) => `category:${value}`),
          ...(filters.includeUncategorized ? ["uncategorized:"] : []),
        ]}
        options={[
          ...(options?.categories.map((value) => ({
            value: `category:${value}`,
            label: value,
          })) ?? []),
          { value: "uncategorized:", label: "Uncategorized / not recorded" },
        ]}
        onChange={(value) =>
          onChange({
            ...filters,
            categories: value.startsWith("category:") ? [value.slice(9)] : [],
            includeUncategorized: value === "uncategorized:",
          })
        }
      />
      <FilterSelect
        label="Outcome"
        values={filters.outcome ? [filters.outcome] : []}
        options={["passed", "failed", "unavailable"].map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        }))}
        onChange={(value) =>
          onChange({
            ...filters,
            outcome: value
              ? (value as EvaluationResultFilters["outcome"])
              : undefined,
          })
        }
      />
      <FilterSelect
        label="Test type"
        values={filters.caseType ? [filters.caseType] : []}
        options={[
          { value: "standard", label: "Standard" },
          { value: "security", label: "Security" },
        ]}
        onChange={(value) =>
          onChange({
            ...filters,
            caseType: value
              ? (value as EvaluationResultFilters["caseType"])
              : undefined,
          })
        }
      />
      <Button
        variant="ghost"
        className="max-md:h-11"
        disabled={!hasFilters && !search}
        onClick={onClear}
      >
        Clear filters
      </Button>
    </div>
  )
}
function FilterSelect({
  label,
  values,
  options,
  onChange,
}: {
  label: string
  values: string[]
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const multiple = values.length > 1
  return (
    <label className="flex min-w-0 flex-col gap-1 text-caption text-fg-muted">
      {label}
      <Select
        aria-label={label}
        value={multiple ? "__multiple__" : (values[0] ?? "")}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All</option>
        {multiple && (
          <option value="__multiple__" disabled>
            {values.length} selected (URL)
          </option>
        )}
        {Array.from(new Set(values))
          .filter((value) => !options.some((option) => option.value === value))
          .map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  )
}
function StatusBadge({ status }: { status: EvaluationRunStatus }) {
  return (
    <Badge
      variant={
        status === "completed"
          ? "success"
          : status === "failed"
            ? "destructive"
            : "info"
      }
    >
      {status === "completed" ? "✓" : status === "failed" ? "✕" : "●"} {status}
    </Badge>
  )
}
function ModelName({ result }: { result: EvaluationResult }) {
  return (
    <>
      {result.model_name}
      {result.reported_model_name &&
        result.reported_model_name !== result.model_name && (
          <div className="font-mono text-data-sm text-fg-muted [overflow-wrap:anywhere]">
            {result.reported_model_name}
          </div>
        )}
    </>
  )
}
function outcomeLabel(result: EvaluationResult) {
  if (result.status === "pending" || result.status === "running")
    return result.status
  if (result.status === "failed") return "request failed"
  if (result.case_type === "security")
    return result.security_status ?? "unavailable"
  const score = result.quality_scores.find(
    (item) => item.method === "normalized_contains_match" && item.version === 1,
  )?.score
  return score === 1 ? "passed" : score === 0 ? "failed" : "unavailable"
}
function Outcome({ result }: { result: EvaluationResult }) {
  const label = outcomeLabel(result)
  const live = label === "running" || label === "pending"
  return (
    <Badge
      variant={
        label === "passed"
          ? "success"
          : label.includes("failed")
            ? "destructive"
            : live
              ? "info"
              : "outline"
      }
    >
      {label === "passed"
        ? "✓"
        : label.includes("failed")
          ? "✕"
          : live
            ? "●"
            : "—"}{" "}
      {label}
    </Badge>
  )
}
function ResultCost({ result }: { result: EvaluationResult }) {
  return result.estimated_cost_usd === null ? (
    <span className={result.pricing ? "text-fg-muted" : "text-warning"}>
      {result.pricing ? "—" : "⚠ no price"}
    </span>
  ) : (
    <>{usd(result.estimated_cost_usd)}</>
  )
}
function RequestError({ result }: { result: EvaluationResult }) {
  return (
    <p className="font-mono text-data-sm text-destructive [overflow-wrap:anywhere]">
      <span>{errorTypeLabel(result.error_code)}:</span>{" "}
      {result.error_code && <span>{result.error_code} · </span>}
      <span>{result.error_message ?? "Model request failed."}</span>
    </p>
  )
}
function PromptDisclosure({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="min-w-0">
      <Button
        variant="ghost"
        className="max-md:h-11 max-md:w-full max-md:justify-start"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        )}{" "}
        {label}
        {!value && " · none"}
      </Button>
      <div id={id} hidden={!open}>
        {open && (
          <InsetPane label={label} mono>
            {value || "No system prompt"}
          </InsetPane>
        )}
      </div>
    </div>
  )
}
function ResultDetails({ result }: { result: EvaluationResult }) {
  const outcome = outcomeLabel(result)
  return (
    <div className="min-w-0 space-y-3">
      <ResultPanes>
        <InsetPane label="Input">{result.test_input}</InsetPane>
        <InsetPane
          label={
            result.case_type === "security" ? "Failure marker" : "Expected"
          }
        >
          {result.expected_output}
        </InsetPane>
        <InsetPane
          label="Generated"
          verdict={
            outcome === "failed" && result.case_type === "standard"
              ? "✕ expected text not found"
              : outcome
          }
          verdictTone={
            outcome === "passed"
              ? "success"
              : result.status === "pending" || result.status === "running"
                ? "info"
                : outcome === "unavailable"
                  ? "neutral"
                  : "destructive"
          }
        >
          {result.status === "running"
            ? "Waiting for the model response…"
            : result.status === "pending"
              ? "Waiting to be processed…"
              : result.status === "failed"
                ? "Model request failed."
                : (result.generated_output ?? "No output returned.")}
        </InsetPane>
      </ResultPanes>
      <dl className="grid min-w-0 grid-cols-3 gap-3 font-mono text-data md:flex md:flex-wrap">
        <Metric label="Latency" value={formatMs(result.latency_ms)} />
        <Metric
          label="Input tokens"
          value={formatTokens(result.input_tokens)}
        />
        <Metric
          label="Output tokens"
          value={formatTokens(result.output_tokens)}
        />
        <Metric
          label="Max output tokens"
          value={formatInt(result.max_output_tokens)}
        />
        <Metric
          label="Total tokens"
          value={formatTokens(result.total_tokens)}
        />
        <Metric label="Est. cost" value={<ResultCost result={result} />} />
        {result.quality_scores.map((score) => (
          <Metric
            key={`${score.method}-${score.version}`}
            label={`${qualityMetricLabel(score.method)} v${score.version}`}
            value={formatPercent(score.score)}
          />
        ))}
        {result.case_type === "security" && (
          <Metric
            label={`Security · Rule version ${result.security_metric_version ?? "—"}`}
            value={result.security_status ?? "unavailable"}
          />
        )}
      </dl>
      {result.case_type === "standard" &&
        result.quality_scores.length === 0 && (
          <p className="text-caption text-fg-muted">
            Quality scores unavailable for this historical result.
          </p>
        )}
      <p className="font-mono text-data-sm text-fg-muted [overflow-wrap:anywhere]">
        Test case ID: {result.test_case_id}
      </p>
      <p className="min-w-0 font-mono text-data-sm text-fg-muted [overflow-wrap:anywhere]">
        {result.case_type} · rep {result.repetition}
        {result.security_test_type &&
          ` · ${securityTypeLabel(result.security_test_type)}`}
      </p>
      <div className="min-w-0 text-caption text-fg-muted [overflow-wrap:anywhere]">
        <ModelName result={result} /> · {result.model_provider} ·{" "}
        {result.prompt_name} · v{result.prompt_version_number}
      </div>
      {result.pricing && (
        <p className="text-caption text-fg-muted [overflow-wrap:anywhere]">
          Estimate uses{" "}
          {formatPricePerMillion(result.pricing.input_usd_per_million_tokens)}{" "}
          input and{" "}
          {formatPricePerMillion(result.pricing.output_usd_per_million_tokens)}{" "}
          output per 1M tokens ·{" "}
          {result.pricing.source === "openrouter"
            ? `OpenRouter price retrieved ${result.pricing.fetched_at ?? result.pricing.effective_date}`
            : `${result.pricing.source} · effective ${result.pricing.effective_date}`}
          {result.pricing.stale && (
            <span className="text-warning"> · ⚠ stale price</span>
          )}
          {result.pricing.source_url && (
            <>
              {" "}
              ·{" "}
              <a
                className={buttonVariants({
                  variant: "link",
                  size: "xs",
                  className: "max-md:h-11 md:h-auto",
                })}
                href={result.pricing.source_url}
                target="_blank"
                rel="noreferrer"
              >
                source
              </a>
            </>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1 md:flex-row">
        <PromptDisclosure
          label="Rendered prompt"
          value={result.rendered_prompt}
        />
        <PromptDisclosure label="System prompt" value={result.system_prompt} />
      </div>
    </div>
  )
}
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <dt className="min-w-0 text-caption text-fg-muted [overflow-wrap:anywhere]">
        {label}
      </dt>
      <dd className="min-w-0 font-mono text-data [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  )
}
function Breakdown({
  results,
  partial,
}: {
  results: EvaluationResult[]
  partial: boolean
}) {
  const groups = new Map<string, EvaluationResult[]>()
  const modelIds = Array.from(new Set(results.map((row) => row.model_id)))
  results.forEach((row) => {
    const key = `${row.model_id}:${row.prompt_version_id}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  })
  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null
  const sum = (values: number[]) =>
    values.length ? values.reduce((total, value) => total + value, 0) : null
  return (
    <Card className="hidden md:flex">
      <CardHeader>
        <CardTitle>Breakdown</CardTitle>
        <CardDescription>
          {partial ? "Loaded results only · " : ""}Failed requests are excluded
          from averages.
        </CardDescription>
      </CardHeader>
      <Table aria-label="Breakdown" className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            {[
              "Model",
              "Prompt version",
              "Requests",
              "Contains",
              "Exact",
              "Avg latency",
              "Tokens",
              "Est. cost",
            ].map((label, index) => (
              <TableHead
                key={label}
                className={index > 1 ? "text-right" : undefined}
              >
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from(groups, ([key, rows]) => {
            const first = rows[0]
            const succeeded = rows.filter((row) => row.status === "succeeded")
            const score = (method: string) =>
              average(
                succeeded.flatMap((row) =>
                  row.quality_scores
                    .filter(
                      (item) =>
                        item.method === method &&
                        item.version === 1 &&
                        item.score !== null,
                    )
                    .map((item) => item.score as number),
                ),
              )
            const contains = score("normalized_contains_match")
            return (
              <TableRow key={key}>
                <TableCell className="[overflow-wrap:anywhere]">
                  <span
                    aria-hidden="true"
                    className={
                      [
                        "text-series-1",
                        "text-series-2",
                        "text-series-3",
                        "text-series-4",
                      ][modelIds.indexOf(first.model_id) % 4]
                    }
                  >
                    ●{" "}
                  </span>
                  {first.model_name}
                </TableCell>
                <TableCell className="[overflow-wrap:anywhere]">
                  {first.prompt_name}{" "}
                  <span className="font-mono text-fg-muted">
                    v{first.prompt_version_number}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {rows.length}
                  <div className="text-destructive text-data-sm">
                    {rows.filter((row) => row.status === "failed").length} ✕
                    failed
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatPercent(contains)}
                  {contains !== null && (
                    <MeterBar
                      value={contains}
                      className="mt-1 w-24"
                      aria-label={`${first.model_name} · ${first.prompt_name} contains`}
                    />
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatPercent(score("normalized_exact_match"))}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatMs(
                    average(
                      succeeded.flatMap((row) =>
                        row.latency_ms === null ? [] : [row.latency_ms],
                      ),
                    ),
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatTokens(
                    sum(
                      rows.flatMap((row) =>
                        row.total_tokens === null ? [] : [row.total_tokens],
                      ),
                    ),
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {usd(
                    sum(
                      rows.flatMap((row) =>
                        row.estimated_cost_usd === null
                          ? []
                          : [Number(row.estimated_cost_usd)],
                      ),
                    ),
                  )}
                  <div className="text-data-sm text-fg-muted">
                    {
                      rows.filter((row) => row.estimated_cost_usd === null)
                        .length
                    }{" "}
                    unpriced
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
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
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="mt-1 font-mono text-data">
        {formatMetric(aggregate.sum_tokens)}
      </dd>
      <dd className="mt-1 text-caption text-fg-muted">
        {formatAvailability(
          aggregate.recorded_results,
          aggregate.unavailable_results,
        )}
      </dd>
    </div>
  )
}

function CostSummary({ summary }: { summary: EvaluationCostSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Estimated costs</h2>
        </CardTitle>
        <CardDescription>
          USD estimates from snapshotted model rates and provider-reported token
          usage. Taxes, discounts, caching, and provider billing adjustments are
          not included.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Metric
            label="Evaluation total"
            value={formatUsd(summary.overall.estimated_usd)}
          />
          <Metric
            label="Average per complete test case"
            value={formatUsd(summary.average_complete_test_case_usd)}
          />
        </dl>
        <p className="text-caption text-fg-muted">
          {summary.overall.priced_results} requests priced ·{" "}
          {summary.overall.unavailable_results} unavailable ·{" "}
          {summary.complete_test_cases} complete test cases ·{" "}
          {summary.incomplete_test_cases} incomplete
        </p>
        <div>
          <h3 className="text-body font-medium">By model</h3>
          <dl className="mt-2 space-y-2">
            {summary.by_model.map((model) => (
              <div
                key={model.model_id}
                className="flex min-w-0 justify-between gap-3 [overflow-wrap:anywhere] rounded-lg bg-muted p-3"
              >
                <dt className="min-w-0 text-body [overflow-wrap:anywhere]">
                  {model.model_name}
                </dt>
                <dd className="min-w-0 text-right font-mono text-data [overflow-wrap:anywhere]">
                  {formatUsd(model.estimated_usd)}
                  <span className="block text-caption font-normal text-fg-muted">
                    {model.priced_results} priced · {model.unavailable_results}{" "}
                    unavailable
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
  return formatMs(value)
}

function formatAvailability(recorded: number, unavailable: number): string {
  return `${recorded} recorded · ${unavailable} unavailable`
}

function ErrorMessage({
  message,
  errorCode,
}: {
  message: string
  errorCode?: string | null
}) {
  return (
    <Alert variant="destructive" className="flex gap-2" role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p>
        {errorCode !== undefined && (
          <span className="font-medium">{errorTypeLabel(errorCode)}: </span>
        )}
        {message}
      </p>
    </Alert>
  )
}

function errorTypeLabel(errorCode: string | null): string {
  const labels: Record<string, string> = {
    provider_unavailable: "Provider unavailable",
    invalid_api_key: "Invalid API key",
    rate_limit: "Rate limit",
    timeout: "Timeout",
    malformed_response: "Malformed response",
    unsupported_model: "Unsupported model",
    configuration_error: "Configuration error",
    provider_error: "Provider error",
    unexpected_error: "Unexpected error",
  }
  if (errorCode === null) return "Request failed"
  return (
    labels[errorCode] ??
    errorCode
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  )
}

function formatMetric(value: number | null) {
  return formatTokens(value)
}

function formatUsd(value: string | null) {
  return usd(value)
}

function SecuritySummary({ summary }: { summary: EvaluationSecuritySummary }) {
  return (
    <Card>
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
          <p className="font-mono text-metric-lg">
            {formatQualityScore(summary.overall.score)}
          </p>
          <SecurityCounts aggregate={summary.overall} />
          <p className="mt-1 text-caption text-fg-muted">
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
      <h3 className="text-body font-medium">{title}</h3>
      <dl className="mt-2 space-y-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-start justify-between gap-4 rounded-lg bg-muted p-3"
          >
            <dt className="min-w-0 text-body [overflow-wrap:anywhere]">
              {row.label}
            </dt>
            <dd className="min-w-0 text-right font-mono text-data [overflow-wrap:anywhere]">
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
      className={`${compact ? "block" : "mt-1 block"} text-caption font-normal text-fg-muted`}
    >
      {aggregate.passed_tests} passed · {aggregate.failed_tests} failed ·{" "}
      {aggregate.unavailable_tests} unavailable · {aggregate.total_tests} total
    </span>
  )
}

function QualitySummary({ summary }: { summary: EvaluationQualitySummary }) {
  return (
    <section
      className="min-w-0 space-y-4 [overflow-wrap:anywhere]"
      aria-labelledby="quality-heading"
    >
      <div>
        <h2 id="quality-heading" className="text-section">
          Response quality
        </h2>
        <p className="mt-1 text-body text-fg-muted">
          Deterministic normalized matching. Pending and failed requests are
          excluded from averages and shown as unavailable.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {summary.metrics.map((metric) => (
          <Card key={`${metric.method}-${metric.version}`}>
            <CardHeader>
              <CardTitle>
                <h3>{qualityMetricLabel(metric.method)}</h3>
              </CardTitle>
              <CardDescription>Metric version {metric.version}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <p className="font-mono text-metric-lg">
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
      <h4 className="text-body font-medium">{title}</h4>
      <dl className="mt-2 space-y-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-start justify-between gap-4 rounded-lg bg-muted p-3"
          >
            <dt className="min-w-0 text-body [overflow-wrap:anywhere]">
              {row.label}
            </dt>
            <dd className="min-w-0 text-right font-mono text-data [overflow-wrap:anywhere]">
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
      className={`${compact ? "block" : "mt-1 block"} text-caption font-normal text-fg-muted`}
    >
      {aggregate.scored_results} scored · {aggregate.unavailable_results}{" "}
      unavailable
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
  return formatPercent(value)
}

function PerformanceSummary({
  summary,
}: {
  summary: EvaluationPerformanceSummary
}) {
  const latency = summary.latency
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Performance</h2>
        </CardTitle>
        <CardDescription>
          Full-response latency and normalized provider token usage. Missing
          values are excluded from aggregates.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-6 lg:grid-cols-2">
        <section className="min-w-0" aria-labelledby="latency-summary-heading">
          <h3 id="latency-summary-heading" className="font-medium">
            Latency
          </h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <Metric label="Average" value={formatLatency(latency.average_ms)} />
            <Metric label="Minimum" value={formatLatency(latency.minimum_ms)} />
            <Metric label="Maximum" value={formatLatency(latency.maximum_ms)} />
          </dl>
          <p className="mt-2 font-mono text-data text-fg-muted [overflow-wrap:anywhere]">
            {formatAvailability(
              latency.recorded_results,
              latency.unavailable_results,
            )}
          </p>
          <h4 className="mt-4 text-caption font-medium uppercase tracking-wide text-fg-muted">
            Average by model
          </h4>
          <ul className="mt-2 space-y-2 text-body">
            {summary.latency_by_model.map((model) => (
              <li
                key={model.model_id}
                className="flex min-w-0 justify-between gap-3 [overflow-wrap:anywhere]"
              >
                <span className="min-w-0">{model.model_name}</span>
                <span className="min-w-0 text-right font-mono text-data text-fg-muted">
                  {formatLatency(model.average_ms)} ·{" "}
                  {formatAvailability(
                    model.recorded_results,
                    model.unavailable_results,
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="min-w-0" aria-labelledby="token-summary-heading">
          <h3 id="token-summary-heading" className="font-medium">
            Token usage
          </h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <AggregateMetric label="Input" aggregate={summary.input_tokens} />
            <AggregateMetric label="Output" aggregate={summary.output_tokens} />
            <AggregateMetric label="Total" aggregate={summary.total_tokens} />
          </dl>
          <h4 className="mt-4 text-caption font-medium uppercase tracking-wide text-fg-muted">
            Total by model
          </h4>
          <ul className="mt-2 space-y-2 text-body">
            {summary.token_usage_by_model.map((model) => (
              <li
                key={model.model_id}
                className="flex min-w-0 justify-between gap-3 [overflow-wrap:anywhere]"
              >
                <span className="min-w-0">{model.model_name}</span>
                <span className="min-w-0 text-right font-mono text-data text-fg-muted">
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
