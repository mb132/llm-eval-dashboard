import { ArrowUpRight, LoaderCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  getEvaluationCostSummary,
  getEvaluationPerformanceSummary,
  getEvaluationQualitySummary,
  getEvaluationRun,
  getEvaluationSecuritySummary,
  getPastEvaluations,
  type EvaluationCostSummary,
  type EvaluationPerformanceSummary,
  type EvaluationQualitySummary,
  type EvaluationRun,
  type EvaluationRunPage,
  type EvaluationSecuritySummary,
  type CostAggregate,
  type LatencyAggregate,
  type QualityAggregate,
  type SecurityAggregate,
  type TokenAggregate,
} from "@/api/evaluations"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { ComparisonChart } from "@/components/charts/relative-profile"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetricStrip, MetricCell } from "@/components/ui/metric-strip"
import { MeterBar, SplitBar } from "@/components/ui/meter"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { Select } from "@/components/ui/select"
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
  formatShortDate,
  formatPercent,
  formatInt,
  formatMs,
  formatTokens,
  formatUsd,
} from "@/lib/format"
import { cn } from "@/lib/utils"
const RUN_PAGE_SIZE = 20
type DashboardView = "models" | "prompts"
type Summaries = {
  quality: EvaluationQualitySummary
  security: EvaluationSecuritySummary
  performance: EvaluationPerformanceSummary
  cost: EvaluationCostSummary
}

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedRunId = searchParams.get("run")
  const [view, setView] = useState<DashboardView>("models")
  const [runPage, setRunPage] = useState<EvaluationRunPage | null>(null)
  const [selectedRun, setSelectedRun] = useState<EvaluationRun | null>(null)
  const [summaries, setSummaries] = useState<Summaries | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [pagingError, setPagingError] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isLoadingSummary, setIsLoadingSummary] = useState(false)
  const [showAllRecent, setShowAllRecent] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let active = true
    setIsLoadingHistory(true)
    getPastEvaluations(0, RUN_PAGE_SIZE)
      .then((page) => {
        if (!active) return
        setRunPage(page)
        setHistoryError(null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setHistoryError(
          errorMessage(error, "Could not load evaluation history."),
        )
      })
      .finally(() => {
        if (active) setIsLoadingHistory(false)
      })
    return () => {
      active = false
    }
  }, [retryKey])

  useEffect(() => {
    if (!runPage || historyError) return
    if (!selectedRunId) {
      const defaultRun =
        runPage.items.find((run) => run.status === "completed") ??
        runPage.items.find((run) => run.status === "failed")
      if (defaultRun) {
        const params = new URLSearchParams(searchParams)
        params.set("run", defaultRun.id)
        setSearchParams(params, { replace: true })
      }
      return
    }

    let active = true
    setIsLoadingSummary(true)
    setSelectedRun(null)
    setSummaryError(null)
    setSummaries(null)

    async function loadSelection() {
      try {
        const run =
          runPage?.items.find((item) => item.id === selectedRunId) ??
          (await getEvaluationRun(selectedRunId ?? ""))
        if (!active) return
        setSelectedRun(run)
        if (run.status === "pending" || run.status === "running") return
        const [quality, security, performance, cost] = await Promise.all([
          getEvaluationQualitySummary(run.id),
          getEvaluationSecuritySummary(run.id),
          getEvaluationPerformanceSummary(run.id),
          getEvaluationCostSummary(run.id),
        ])
        if (active) setSummaries({ quality, security, performance, cost })
      } catch (error) {
        if (active) {
          setSummaryError(errorMessage(error, "Could not load dashboard data."))
        }
      } finally {
        if (active) setIsLoadingSummary(false)
      }
    }

    void loadSelection()
    return () => {
      active = false
    }
  }, [historyError, runPage, selectedRunId, setSearchParams, searchParams])

  const terminalRuns = runPage?.items.filter(isTerminal) ?? []
  const activeRuns = runPage?.items.filter((run) => !isTerminal(run)) ?? []

  async function loadMoreRuns() {
    if (!runPage || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const next = await getPastEvaluations(runPage.items.length, RUN_PAGE_SIZE)
      setRunPage({
        ...next,
        items: [...runPage.items, ...next.items],
        offset: 0,
      })
      setPagingError(null)
    } catch (error) {
      setPagingError(errorMessage(error, "Could not load more evaluations."))
    } finally {
      setIsLoadingMore(false)
    }
  }

  const modelRows = summaries ? comparisonRows(summaries) : []
  const promptRows = summaries ? promptComparisonRows(summaries) : []
  const rows = view === "models" ? modelRows : promptRows
  const selectedHistory = runPage?.items.find((run) => run.id === selectedRunId)
  const promptNames =
    selectedHistory?.prompt_versions?.map(
      (prompt) => `${prompt.name} · v${prompt.version_number}`,
    ) ?? promptRows.map((row) => row.name)
  const modelCount = selectedHistory?.models?.length ?? modelRows.length
  const picker = (id: string) => (
    <div className="flex min-w-0 items-center gap-2 md:min-w-80">
      <label htmlFor={id} className="text-caption text-fg-muted">
        Run
      </label>
      <Select
        id={id}
        value={selectedRunId ?? ""}
        className="min-w-0 flex-1 font-mono text-data md:h-8 max-md:h-11"
        onChange={(event) => {
          const params = new URLSearchParams(searchParams)
          params.set("run", event.target.value)
          setSearchParams(params)
        }}
      >
        {selectedRunId &&
          !terminalRuns.some((run) => run.id === selectedRunId) && (
            <option value={selectedRunId}>
              {selectedRun ? runOption(selectedRun) : selectedRunId.slice(0, 8)}
            </option>
          )}
        {terminalRuns.map((run) => (
          <option key={run.id} value={run.id}>
            {runOption(run)}
          </option>
        ))}
      </Select>
    </div>
  )
  const openResults = selectedRun && (
    <Link
      to={`/evaluations/${selectedRun.id}`}
      className={buttonVariants({
        variant: "outline",
        size: "sm",
        className: "max-md:h-11",
      })}
    >
      Open results <ArrowUpRight aria-hidden="true" className="size-3.5" />
    </Link>
  )
  return (
    <PageFrame
      breadcrumbs={[
        { label: "Dashboard" },
        ...(selectedRunId
          ? [{ label: selectedRunId.slice(0, 8), title: selectedRunId }]
          : []),
      ]}
      mobileTitle="Dashboard"
      actions={
        <>
          {picker("dashboard-run-desktop")}
          {openResults}
        </>
      }
    >
      {(isLoadingHistory ||
        (historyError && !runPage) ||
        (!selectedRunId && terminalRuns.length === 0)) && (
        <PageHeader title="Dashboard" />
      )}
      {isLoadingHistory ? (
        <DashboardLoading />
      ) : historyError && !runPage ? (
        <ErrorState
          message={historyError}
          onRetry={() => setRetryKey((value) => value + 1)}
        />
      ) : !selectedRunId && terminalRuns.length === 0 ? (
        <Card>
          <EmptyState
            title="No completed evaluations yet"
            description="Run an evaluation to compare quality, performance, cost, and security in one place."
            action={
              <Link
                to="/evaluations/new"
                className={buttonVariants({ className: "max-md:h-11" })}
              >
                New evaluation
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <div className="md:hidden">{picker("dashboard-run-mobile")}</div>
          <PageHeader
            title={
              selectedRun
                ? `${selectedRun.dataset_name} evaluation`
                : "Run dashboard"
            }
            accessory={selectedRun && <RunStatus status={selectedRun.status} />}
            metadata={
              selectedRun && (
                <>
                  <span>
                    Run{" "}
                    <span className="font-mono text-fg" title={selectedRun.id}>
                      {selectedRun.id.slice(0, 8)}
                    </span>
                  </span>
                  <span>{formatDateTime(selectedRun.created_at)}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    Dataset{" "}
                    <span className="text-fg">{selectedRun.dataset_name}</span>
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {promptNames.length === 1
                      ? `Prompt ${promptNames[0]}`
                      : `Prompts ${promptNames.length || "—"}`}
                  </span>
                  <span>Models {modelCount || "—"}</span>
                </>
              )
            }
          />
          <div className="grid md:hidden">{openResults}</div>
          {isLoadingSummary && <DashboardLoading />}
          {summaryError && (
            <ErrorState
              message={summaryError}
              onRetry={() => setRetryKey((value) => value + 1)}
            />
          )}
          {selectedRun && !isTerminal(selectedRun) && (
            <Alert variant="info" role="status">
              <div>
                This run is still running. Numbers update when it finishes.{" "}
                <Link
                  className="text-link underline"
                  to={`/evaluations/${selectedRun.id}`}
                >
                  View progress
                </Link>
              </div>
            </Alert>
          )}
          {selectedRun && summaries && (
            <Overview run={selectedRun} summaries={summaries} />
          )}
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-5">
              {summaries && selectedRun && (
                <>
                  <Card className="gap-0 overflow-hidden py-0">
                    <CardHeader className="gap-2 border-b border-line">
                      <CardTitle>Comparison</CardTitle>
                      <SegmentedControl
                        label="Compare by"
                        value={view}
                        onValueChange={(value) =>
                          setView(value as DashboardView)
                        }
                        options={[
                          {
                            value: "models",
                            label: "Models",
                            count: modelRows.length,
                            id: "dashboard-tab-models",
                            panelId: "dashboard-panel-models",
                          },
                          {
                            value: "prompts",
                            label: "Prompt versions",
                            count: promptRows.length,
                            id: "dashboard-tab-prompts",
                            panelId: "dashboard-panel-prompts",
                          },
                        ]}
                      />
                      <p className="text-caption text-fg-muted">
                        Same dataset · same run. Best labels exclude partial
                        data.
                      </p>
                    </CardHeader>
                    <div
                      id={`dashboard-panel-${view}`}
                      role="tabpanel"
                      aria-labelledby={`dashboard-tab-${view}`}
                    >
                      {view === "prompts" && promptRows.length < 2 && (
                        <p className="p-4 text-caption text-fg-muted">
                          This run contains only one prompt version. Select at
                          least two versions when configuring an evaluation to
                          compare them here.
                        </p>
                      )}
                      <ComparisonSection
                        rows={rows}
                        entity={view === "models" ? "Model" : "Prompt version"}
                        run={selectedRun}
                      />
                    </div>
                  </Card>
                  <ComparisonChart
                    rows={rows.map((row) => ({
                      id: row.id,
                      name: row.name,
                      quality: completeScore(row.contains),
                      latency: completeLatency(row.latency),
                      tokens: completeTokens(row.tokens),
                      cost: completeCost(row.cost),
                      security: completeSecurity(row.security),
                    }))}
                  />
                </>
              )}
            </div>
            <Card className="h-fit gap-0 py-0">
              <CardHeader className="flex-row items-center justify-between border-b border-line">
                <CardTitle>Recent runs</CardTitle>
                <Link
                  to="/evaluations/history"
                  className="inline-flex items-center text-caption text-link max-md:min-h-11"
                >
                  All runs
                </Link>
              </CardHeader>
              {pagingError && (
                <ErrorState
                  message={pagingError}
                  onRetry={() => void loadMoreRuns()}
                />
              )}
              <ul className="p-1">
                {terminalRuns.map((run, index) => (
                  <li
                    key={run.id}
                    className={
                      !showAllRecent && index >= 4
                        ? "hidden md:block"
                        : undefined
                    }
                  >
                    <Link
                      to={`?${new URLSearchParams({ ...Object.fromEntries(searchParams), run: run.id })}`}
                      aria-current={
                        selectedRunId === run.id ? "true" : undefined
                      }
                      className={cn(
                        "flex min-h-13 items-center gap-3 rounded-md px-3 py-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring",
                        selectedRunId === run.id && "bg-selected",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body">
                          {run.dataset_name}
                        </span>
                        <span
                          className="block font-mono text-data-sm text-fg-muted"
                          title={run.id}
                        >
                          {run.id.slice(0, 8)} ·{" "}
                          {formatShortDate(run.created_at).replace("\n", ", ")}
                        </span>
                      </span>
                      <span className="font-mono text-data text-right">
                        {run.successful_requests}/{run.total_requests}
                        <span
                          className={cn(
                            "block",
                            run.failed_requests
                              ? "text-destructive"
                              : "text-success",
                          )}
                        >
                          {run.failed_requests
                            ? `✕ ${run.failed_requests}`
                            : "✓"}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {!showAllRecent && terminalRuns.length > 4 && (
                <Button
                  variant="ghost"
                  className="h-11 md:hidden"
                  onClick={() => setShowAllRecent(true)}
                >
                  Show {terminalRuns.length - 4} more recent runs
                </Button>
              )}
              {runPage && runPage.items.length < runPage.total && (
                <Button
                  variant="ghost"
                  className="max-md:h-11"
                  disabled={isLoadingMore}
                  onClick={() => void loadMoreRuns()}
                >
                  {isLoadingMore
                    ? "Loading…"
                    : `Load ${Math.min(RUN_PAGE_SIZE, runPage.total - runPage.items.length)} more`}
                </Button>
              )}
            </Card>
          </div>
        </>
      )}
      {activeRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active evaluations</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {activeRuns.map((run) => (
              <Link
                key={run.id}
                to={`/evaluations/${run.id}`}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className:
                    "max-md:h-11 min-w-0 whitespace-normal [overflow-wrap:anywhere]",
                })}
              >
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3.5 animate-spin"
                />
                {run.dataset_name} · {run.completed_requests}/
                {run.total_requests}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </PageFrame>
  )
}
function DashboardLoading() {
  return (
    <>
      <MetricStrip aria-label="Run overview">
        {[
          "Quality · contains",
          "Requests",
          "Avg latency",
          "Total tokens",
          "Est. cost",
          "Security",
        ].map((label) => (
          <MetricCell
            key={label}
            label={label}
            value={
              <span className="block h-8 animate-pulse rounded-sm bg-hover" />
            }
          />
        ))}
      </MetricStrip>
      <Card>
        <CardHeader>
          <CardTitle>Comparison</CardTitle>
        </CardHeader>
        <LoadingState label="Loading dashboard…" />
      </Card>
    </>
  )
}
function Overview({
  run,
  summaries,
}: {
  run: EvaluationRun
  summaries: Summaries
}) {
  const contains = metric(
    summaries.quality,
    "normalized_contains_match",
  )?.overall
  const exact = metric(summaries.quality, "normalized_exact_match")?.overall
  const security = summaries.security.overall
  return (
    <MetricStrip aria-label="Run overview">
      <MetricCell
        label="Quality · contains"
        value={formatPercent(contains?.average_score).replace(/%$/, "")}
        unit="%"
        visual={
          contains?.average_score != null && (
            <MeterBar aria-hidden="true" value={contains.average_score} />
          )
        }
        subValue={
          contains
            ? `exact ${formatPercent(exact?.average_score)} · ${contains.scored_results} scored`
            : "Quality data unavailable"
        }
      />
      <MetricCell
        label="Requests"
        value={formatInt(run.successful_requests)}
        unit={`/${formatInt(run.total_requests)}`}
        visual={
          <SplitBar
            aria-hidden="true"
            segments={[
              { value: run.successful_requests, tone: "success" },
              { value: run.failed_requests, tone: "destructive" },
            ]}
          />
        }
        subValue={`✓ ${run.successful_requests} ok · ✕ ${run.failed_requests} failed`}
      />
      <MetricCell
        label="Avg latency"
        value={
          summaries.performance.latency.average_ms == null
            ? "—"
            : formatMs(summaries.performance.latency.average_ms).replace(
                / ms$/,
                "",
              )
        }
        unit="ms"
        subValue={availability(
          summaries.performance.latency.recorded_results,
          summaries.performance.latency.unavailable_results,
        )}
      />
      <MetricCell
        label="Total tokens"
        value={formatTokens(summaries.performance.total_tokens.sum_tokens)}
        subValue={availability(
          summaries.performance.total_tokens.recorded_results,
          summaries.performance.total_tokens.unavailable_results,
        )}
      />
      <MetricCell
        label="Est. cost"
        value={
          summaries.cost.overall.estimated_usd == null ? (
            "—"
          ) : (
            <span>
              <span className="text-[16px] text-fg-muted">$</span>
              {formatUsd(summaries.cost.overall.estimated_usd).replace(/^\$/, "")}
            </span>
          )
        }
        subValue={
          <>
            {summaries.cost.overall.priced_results} priced ·{" "}
            <span
              className={
                summaries.cost.overall.unavailable_results
                  ? "text-warning"
                  : undefined
              }
            >
              {summaries.cost.overall.unavailable_results > 0 && "⚠ "}
              {summaries.cost.overall.unavailable_results} unpriced
            </span>
          </>
        }
      />
      <MetricCell
        label="Security"
        value={
          security.total_tests
            ? formatPercent(security.score).replace(/%$/, "")
            : "—"
        }
        unit="%"
        visual={
          security.total_tests > 0 &&
          security.score != null && (
            <MeterBar aria-hidden="true" value={security.score} />
          )
        }
        subValue={
          security.total_tests
            ? `${security.passed_tests}/${security.total_tests} passed · ${security.unavailable_tests} unavailable`
            : "No security cases in dataset"
        }
      />
    </MetricStrip>
  )
}
function ComparisonSection({
  rows,
  entity,
  run,
}: {
  rows: ComparisonRow[]
  entity: string
  run: EvaluationRun
}) {
  const leaders = [
    bestIds(rows, (row) => completeScore(row.contains), "max"),
    bestIds(rows, (row) => completeLatency(row.latency), "min"),
    bestIds(rows, (row) => completeTokens(row.tokens), "min"),
    bestIds(rows, (row) => completeCost(row.cost), "min"),
    bestIds(rows, (row) => completeSecurity(row.security), "max"),
  ]
  const value = (row: ComparisonRow, index: number, text: string) => (
    <span
      className={cn(
        "font-mono text-data [overflow-wrap:anywhere] md:whitespace-nowrap",
        leaders[index].has(row.id) && "text-link",
      )}
    >
      {leaders[index].has(row.id) && <span aria-label="Best">▲ </span>}
      {text}
    </span>
  )
  const failed = run.failed_requests === 0 ? "✕ 0" : "—"
  const failedDetail =
    run.failed_requests === 0
      ? "No failed requests"
      : "Request status unavailable"
  const qualityCell = (row: ComparisonRow) => (
    <div className="space-y-1.5">
      {value(row, 0, formatPercent(row.contains?.average_score))}
      {row.contains?.average_score != null && (
        <MeterBar aria-hidden="true" value={row.contains.average_score} />
      )}
      <p className="text-data-sm text-fg-muted">
        exact {formatPercent(row.exact?.average_score)} ·{" "}
        {row.contains
          ? `${row.contains.unavailable_results} unavailable`
          : "Quality data unavailable"}
      </p>
    </div>
  )
  const securityCell = (row: ComparisonRow) => (
    <div>
      {value(row, 4, formatPercent(row.security?.score))}
      <p className="text-data-sm text-fg-muted">
        {row.security?.total_tests
          ? `${row.security.passed_tests}/${row.security.total_tests} passed · ${row.security.unavailable_tests} unavailable`
          : row.security
            ? "No security cases"
            : "Security data unavailable"}
      </p>
    </div>
  )
  const cells = (row: ComparisonRow) => [
    <>
      {value(row, 1, formatMs(row.latency?.average_ms))}
      <p className="text-data-sm text-fg-muted">
        {row.latency
          ? `${row.latency.unavailable_results} unavailable`
          : "Latency data unavailable"}
      </p>
    </>,
    <>
      {value(row, 2, formatTokens(row.tokens?.total_tokens.sum_tokens))}
      <p className="text-data-sm text-fg-muted">
        {row.tokens
          ? `${row.tokens.total_tokens.unavailable_results} unavailable`
          : "Token data unavailable"}
      </p>
    </>,
    <>
      {value(
        row,
        3,
        !row.cost
          ? "—"
          : row.cost.estimated_usd == null
            ? "⚠ no price"
            : formatUsd(row.cost.estimated_usd),
      )}
      <p className="text-data-sm text-fg-muted">
        {row.cost
          ? `${row.cost.unavailable_results} unpriced`
          : "Cost data unavailable"}
      </p>
      {row.cost?.unavailable_results ? (
        <Link
          to="/models"
          className="inline-flex items-center text-caption text-link max-md:min-h-11"
        >
          Add pricing
        </Link>
      ) : null}
    </>,
    <>
      <span className="font-mono text-data">{failed}</span>
      <p className="text-data-sm text-fg-muted">{failedDetail}</p>
    </>,
  ]
  const name = (row: ComparisonRow, index: number) => (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={cn(
          "mt-1 size-2 shrink-0 rounded-full",
          [
            "bg-series-1",
            "bg-series-2",
            "bg-series-3",
            "bg-series-4 [html[data-theme=light]_&]:bg-transparent [html[data-theme=light]_&]:border [html[data-theme=light]_&]:border-series-4",
          ][index] ?? "bg-primary-muted",
        )}
      />
      <div className="min-w-0">
        <span className="text-body font-medium [overflow-wrap:anywhere]">
          {row.name}
        </span>
      </div>
    </div>
  )
  return (
    <>
      <div className="hidden min-w-0 md:block">
        <Table className="min-w-[850px]">
          <TableHeader>
            <TableRow>
              {[
                entity,
                "Quality · contains",
                "Avg latency",
                "Tokens",
                "Est. cost",
                "Failed",
                "Security",
              ].map((label, index) => (
                <TableHead
                  key={label}
                  className={index ? "text-right" : undefined}
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.id}>
                <TableCell className="min-w-40">{name(row, index)}</TableCell>
                <TableCell className="min-w-36 text-right">
                  {qualityCell(row)}
                </TableCell>
                {cells(row).map((cell, index) => (
                  <TableCell key={index} className="text-right">
                    {cell}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  {securityCell(row)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="divide-y divide-line md:hidden">
        {rows.map((row, index) => (
          <article key={row.id} aria-label={row.name} className="space-y-3 p-3">
            {name(row, index)}
            <div>
              <p className="text-caption text-fg-muted">Quality · contains</p>
              {qualityCell(row)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {cells(row).map((cell, index) => (
                <div key={index} className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="text-caption text-fg-muted">
                    {["Avg latency", "Tokens", "Est. cost", "Failed"][index]}
                  </p>
                  {cell}
                </div>
              ))}
            </div>
            <div>
              <p className="text-caption text-fg-muted">Security</p>
              {securityCell(row)}
            </div>
          </article>
        ))}
      </div>
      {!leaders.some((leader) => leader.size > 0) && (
        <p className="border-t border-line p-3 text-caption text-fg-muted">
          No ▲ best marked:{" "}
          {entity === "Model" ? "every model" : "every prompt version"} has
          unavailable results.
        </p>
      )}
    </>
  )
}
function RunStatus({ status }: { status: EvaluationRun["status"] }) {
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
function isTerminal(run: EvaluationRun) {
  return run.status === "completed" || run.status === "failed"
}
function runOption(run: EvaluationRun) {
  return `${run.dataset_name} · ${formatShortDate(run.created_at).replace("\n", ", ")}`
}
function availability(recorded: number, unavailable: number) {
  return `${recorded} recorded · ${unavailable} unavailable`
}
function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
function metric(summary: EvaluationQualitySummary, method: string) {
  return summary.metrics.find((item) => item.method === method)
}

type ComparisonRow = {
  id: string
  name: string
  contains: QualityAggregate | undefined
  exact: QualityAggregate | undefined
  latency: LatencyAggregate | undefined
  tokens: { total_tokens: TokenAggregate } | undefined
  cost: CostAggregate | undefined
  security: SecurityAggregate | undefined
}

function comparisonRows(summaries: Summaries): ComparisonRow[] {
  const contains = metric(summaries.quality, "normalized_contains_match")
  const exact = metric(summaries.quality, "normalized_exact_match")
  const models = new Map<string, string>()
  const named = [
    ...(contains?.by_model ?? []),
    ...(exact?.by_model ?? []),
    ...summaries.performance.latency_by_model,
    ...summaries.performance.token_usage_by_model,
    ...summaries.cost.by_model,
    ...summaries.security.by_model,
  ]
  named.forEach((item) => models.set(item.model_id, item.model_name))
  return [...models]
    .map(([id, name]) => ({
      id,
      name,
      contains: contains?.by_model.find((item) => item.model_id === id),
      exact: exact?.by_model.find((item) => item.model_id === id),
      latency: summaries.performance.latency_by_model.find(
        (item) => item.model_id === id,
      ),
      tokens: summaries.performance.token_usage_by_model.find(
        (item) => item.model_id === id,
      ),
      cost: summaries.cost.by_model.find((item) => item.model_id === id),
      security: summaries.security.by_model.find(
        (item) => item.model_id === id,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function promptComparisonRows(summaries: Summaries): ComparisonRow[] {
  const contains = metric(summaries.quality, "normalized_contains_match")
  const exact = metric(summaries.quality, "normalized_exact_match")
  const prompts = new Map<
    string,
    { prompt_name: string; prompt_version_number: number }
  >()
  const named = [
    ...(contains?.by_prompt_version ?? []),
    ...(exact?.by_prompt_version ?? []),
    ...summaries.performance.latency_by_prompt_version,
    ...summaries.performance.token_usage_by_prompt_version,
    ...summaries.cost.by_prompt_version,
    ...summaries.security.by_prompt_version,
  ]
  named.forEach((item) =>
    prompts.set(item.prompt_version_id, {
      prompt_name: item.prompt_name,
      prompt_version_number: item.prompt_version_number,
    }),
  )
  return [...prompts]
    .map(([id, prompt]) => ({
      id,
      name: `${prompt.prompt_name} · v${prompt.prompt_version_number}`,
      contains: contains?.by_prompt_version.find(
        (item) => item.prompt_version_id === id,
      ),
      exact: exact?.by_prompt_version.find(
        (item) => item.prompt_version_id === id,
      ),
      latency: summaries.performance.latency_by_prompt_version.find(
        (item) => item.prompt_version_id === id,
      ),
      tokens: summaries.performance.token_usage_by_prompt_version.find(
        (item) => item.prompt_version_id === id,
      ),
      cost: summaries.cost.by_prompt_version.find(
        (item) => item.prompt_version_id === id,
      ),
      security: summaries.security.by_prompt_version.find(
        (item) => item.prompt_version_id === id,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function completeScore(value: QualityAggregate | undefined) {
  return value?.average_score !== null &&
    value?.average_score !== undefined &&
    value.unavailable_results === 0
    ? value.average_score
    : null
}

function completeLatency(value: ComparisonRow["latency"]) {
  return value?.average_ms !== null &&
    value?.average_ms !== undefined &&
    value.unavailable_results === 0
    ? value.average_ms
    : null
}

function completeCost(value: ComparisonRow["cost"]) {
  return value?.estimated_usd !== null &&
    value?.estimated_usd !== undefined &&
    value.unavailable_results === 0
    ? Number(value.estimated_usd)
    : null
}

function completeSecurity(value: ComparisonRow["security"]) {
  return value?.score !== null &&
    value?.score !== undefined &&
    value.total_tests > 0 &&
    value.unavailable_tests === 0
    ? value.score
    : null
}

function bestIds(
  rows: ComparisonRow[],
  value: (row: ComparisonRow) => number | null,
  direction: "min" | "max",
) {
  const candidates = rows.flatMap((row) => {
    const score = value(row)
    return score === null || !Number.isFinite(score)
      ? []
      : [{ id: row.id, score }]
  })
  if (candidates.length === 0 || candidates.length !== rows.length)
    return new Set<string>()
  const best = Math[direction](...candidates.map((item) => item.score))
  return new Set(
    candidates.filter((item) => item.score === best).map((item) => item.id),
  )
}
function completeTokens(value: ComparisonRow["tokens"]) {
  return value?.total_tokens.sum_tokens != null &&
    value.total_tokens.unavailable_results === 0
    ? value.total_tokens.sum_tokens
    : null
}
