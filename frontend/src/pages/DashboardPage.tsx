import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Clock3,
  Coins,
  FlaskConical,
  Gauge,
  History,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trophy,
} from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
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
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

const RUN_PAGE_SIZE = 20
const DASHBOARD_VIEWS = ["overview", "models", "prompts"] as const
type DashboardView = (typeof DASHBOARD_VIEWS)[number]

type Summaries = {
  quality: EvaluationQualitySummary
  security: EvaluationSecuritySummary
  performance: EvaluationPerformanceSummary
  cost: EvaluationCostSummary
}

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedRunId = searchParams.get("run")
  const [view, setView] = useState<DashboardView>("overview")
  const [runPage, setRunPage] = useState<EvaluationRunPage | null>(null)
  const [selectedRun, setSelectedRun] = useState<EvaluationRun | null>(null)
  const [summaries, setSummaries] = useState<Summaries | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isLoadingSummary, setIsLoadingSummary] = useState(false)
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
        setHistoryError(errorMessage(error, "Could not load evaluation history."))
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
      if (defaultRun) setSearchParams({ run: defaultRun.id }, { replace: true })
      return
    }

    let active = true
    setIsLoadingSummary(true)
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
          setSelectedRun(null)
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
  }, [historyError, runPage, selectedRunId, setSearchParams])

  const terminalRuns = runPage?.items.filter(isTerminal) ?? []
  const activeRuns = runPage?.items.filter((run) => !isTerminal(run)) ?? []

  async function loadMoreRuns() {
    if (!runPage || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const next = await getPastEvaluations(runPage.items.length, RUN_PAGE_SIZE)
      setRunPage({ ...next, items: [...runPage.items, ...next.items], offset: 0 })
      setHistoryError(null)
    } catch (error) {
      setHistoryError(errorMessage(error, "Could not load more evaluations."))
    } finally {
      setIsLoadingMore(false)
    }
  }

  if (isLoadingHistory) return <LoadingState label="Loading dashboard…" />

  if (historyError && !runPage) {
    return (
      <ErrorState
        message={historyError}
        onRetry={() => setRetryKey((value) => value + 1)}
      />
    )
  }

  if (!selectedRunId && terminalRuns.length === 0) {
    return <EmptyDashboard activeRuns={activeRuns} />
  }

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-6 py-8 text-card-foreground shadow-sm sm:px-8">
        <div className="absolute -right-20 -top-24 size-72 rounded-full bg-brand-glow/40 blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 size-64 rounded-full bg-brand-glow-alt/40 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand-strong">
              <Gauge className="size-4" /> Evaluation cockpit
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {selectedRun?.dataset_name ?? "Run dashboard"}
            </h1>
            {selectedRun && (
              <p className="mt-3 text-sm text-muted-foreground">
                {formatDate(selectedRun.completed_at ?? selectedRun.created_at)} ·{" "}
                {selectedRun.completed_requests.toLocaleString()} of{" "}
                {selectedRun.total_requests.toLocaleString()} requests completed
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {selectedRun && <RunStatus status={selectedRun.status} />}
            {selectedRun && (
              <Link
                to={`/evaluations/${selectedRun.id}`}
                className={buttonVariants({ size: "sm" })}
              >
                Full run details <ArrowRight className="size-4" />
              </Link>
            )}
            <Link
              to="/evaluations/history"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <History className="size-4" /> History
            </Link>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <label htmlFor="dashboard-run" className="text-sm font-medium">
            Evaluation run
          </label>
          <Select
            id="dashboard-run"
            value={selectedRunId ?? ""}
            onChange={(event) => setSearchParams({ run: event.target.value })}
            className="min-w-72 bg-card"
          >
            {selectedRun && !terminalRuns.some((run) => run.id === selectedRun.id) && (
              <option value={selectedRun.id}>{runOption(selectedRun)}</option>
            )}
            {terminalRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {runOption(run)}
              </option>
            ))}
          </Select>
          {runPage && runPage.items.length < runPage.total && (
            <button
              type="button"
              onClick={loadMoreRuns}
              disabled={isLoadingMore}
              className="w-fit text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
            >
              {isLoadingMore ? "Loading…" : "Load older runs"}
            </button>
          )}
        </div>
        <div
          className="inline-flex w-fit rounded-lg bg-muted p-1"
          role="tablist"
          aria-label="Dashboard view"
          aria-orientation="horizontal"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
            event.preventDefault()
            const index = DASHBOARD_VIEWS.indexOf(view)
            const next = event.key === "Home"
              ? DASHBOARD_VIEWS[0]
              : event.key === "End"
                ? DASHBOARD_VIEWS[DASHBOARD_VIEWS.length - 1]
                : DASHBOARD_VIEWS[
                    (index + (event.key === "ArrowRight" ? 1 : -1) +
                      DASHBOARD_VIEWS.length) % DASHBOARD_VIEWS.length
                  ]
            setView(next)
            document.getElementById(`dashboard-tab-${next}`)?.focus()
          }}
        >
          {DASHBOARD_VIEWS.map((item) => (
            <button
              key={item}
              id={`dashboard-tab-${item}`}
              type="button"
              role="tab"
              aria-selected={view === item}
              aria-controls={`dashboard-panel-${item}`}
              tabIndex={view === item ? 0 : -1}
              onClick={() => setView(item)}
              className={`rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
                view === item
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item === "models"
                ? "Model comparison"
                : item === "prompts"
                  ? "Prompt comparison"
                  : "Overview"}
            </button>
          ))}
        </div>
      </section>

      {activeRuns.length > 0 && <ActiveRuns runs={activeRuns} />}
      {historyError && <InlineError message={historyError} />}
      {isLoadingSummary && <LoadingState label="Calculating run summary…" compact />}
      {summaryError && (
        <ErrorState
          message={summaryError}
          onRetry={() => setRetryKey((value) => value + 1)}
        />
      )}
      {selectedRun && !isTerminal(selectedRun) && <ActiveRun run={selectedRun} />}
      {selectedRun && summaries && view === "overview" && (
        <DashboardPanel view="overview">
          <Overview run={selectedRun} summaries={summaries} />
        </DashboardPanel>
      )}
      {summaries && view === "models" && (
        <DashboardPanel view="models">
          <ModelComparison summaries={summaries} />
        </DashboardPanel>
      )}
      {summaries && view === "prompts" && (
        <DashboardPanel view="prompts">
          <PromptComparison summaries={summaries} />
        </DashboardPanel>
      )}
    </div>
  )
}

function DashboardPanel({ view, children }: { view: DashboardView; children: ReactNode }) {
  return <div id={`dashboard-panel-${view}`} role="tabpanel" aria-labelledby={`dashboard-tab-${view}`}>{children}</div>
}

function Overview({ run, summaries }: { run: EvaluationRun; summaries: Summaries }) {
  const contains = metric(summaries.quality, "normalized_contains_match")
  const exact = metric(summaries.quality, "normalized_exact_match")
  const security = summaries.security.overall
  return (
    <section aria-labelledby="overview-heading" className="space-y-4">
      <div>
        <h2 id="overview-heading" className="text-xl font-semibold">Run overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Comparable metrics from this immutable evaluation snapshot.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Trophy}
          label="Contains quality"
          value={formatPercent(contains?.overall.average_score)}
          detail={`Exact ${formatPercent(exact?.overall.average_score)}`}
        />
        <MetricCard
          icon={Clock3}
          label="Average latency"
          value={formatLatency(summaries.performance.latency.average_ms)}
          detail={availability(
            summaries.performance.latency.recorded_results,
            summaries.performance.latency.unavailable_results,
          )}
        />
        <MetricCard
          icon={Coins}
          label="Estimated cost"
          value={formatCost(summaries.cost.overall.estimated_usd)}
          detail={`${summaries.cost.overall.priced_results} priced · ${summaries.cost.overall.unavailable_results} unavailable`}
        />
        <MetricCard
          icon={ShieldCheck}
          label="Security score"
          value={security.total_tests === 0 ? "No security tests" : formatPercent(security.score)}
          detail={
            security.total_tests === 0
              ? "Add security cases to the dataset"
              : `${security.passed_tests} passed · ${security.failed_tests} failed · ${security.unavailable_tests} unavailable`
          }
        />
      </div>
      <Card>
        <CardContent className="grid gap-4 pt-0 sm:grid-cols-3">
          <RunFact label="Successful requests" value={run.successful_requests.toLocaleString()} />
          <RunFact label="Failed requests" value={run.failed_requests.toLocaleString()} />
          <RunFact
            label="Total tokens"
            value={formatInteger(summaries.performance.total_tokens.sum_tokens)}
          />
        </CardContent>
      </Card>
    </section>
  )
}

function ModelComparison({ summaries }: { summaries: Summaries }) {
  const rows = useMemo(() => comparisonRows(summaries), [summaries])
  return (
    <ComparisonSection
      rows={rows}
      entity="Model"
      title="Model comparison"
      description="Models are compared only within the selected run. Best labels exclude partial data."
    />
  )
}

function PromptComparison({ summaries }: { summaries: Summaries }) {
  const rows = useMemo(() => promptComparisonRows(summaries), [summaries])
  if (rows.length < 2) {
    return (
      <section aria-labelledby="prompt-comparison-heading" className="space-y-4">
        <div>
          <h2 id="prompt-comparison-heading" className="text-xl font-semibold">
            Prompt comparison
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Prompt versions are compared across the same models and dataset in this run.
          </p>
        </div>
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            This run contains only one prompt version. Select at least two versions when
            configuring an evaluation to compare them here.
          </CardContent>
        </Card>
      </section>
    )
  }
  return (
    <ComparisonSection
      rows={rows}
      entity="Prompt version"
      title="Prompt comparison"
      description="Prompt versions are aggregated across the same models and dataset in this run. Best labels exclude partial data."
    />
  )
}

function ComparisonSection({ rows, entity, title, description }: {
  rows: ComparisonRow[]
  entity: "Model" | "Prompt version"
  title: string
  description: string
}) {
  const bestQuality = bestIds(rows, (row) => completeScore(row.contains), "max")
  const bestLatency = bestIds(rows, (row) => completeLatency(row.latency), "min")
  const bestCost = bestIds(rows, (row) => completeCost(row.cost), "min")
  const bestSecurity = bestIds(rows, (row) => completeSecurity(row.security), "max")
  const headingId = entity === "Model" ? "comparison-heading" : "prompt-comparison-heading"

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div>
        <h2 id={headingId} className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{entity}</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Total tokens</TableHead>
              <TableHead>Estimated cost</TableHead>
              <TableHead>Security</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="min-w-44 font-medium">{row.name}</TableCell>
                <TableCell className="min-w-48">
                  <ScoreCell
                    primary={row.contains?.average_score ?? null}
                    secondary={`Exact ${formatPercent(row.exact?.average_score)}`}
                    unavailable={row.contains?.unavailable_results ?? 0}
                    best={bestQuality.has(row.id)}
                  />
                </TableCell>
                <TableCell>
                  <ValueCell
                    value={formatLatency(row.latency?.average_ms)}
                    unavailable={row.latency?.unavailable_results ?? 0}
                    best={bestLatency.has(row.id)}
                  />
                </TableCell>
                <TableCell>
                  <ValueCell
                    value={formatInteger(row.tokens?.total_tokens.sum_tokens)}
                    unavailable={row.tokens?.total_tokens.unavailable_results ?? 0}
                  />
                </TableCell>
                <TableCell>
                  <ValueCell
                    value={formatCost(row.cost?.estimated_usd)}
                    unavailable={row.cost?.unavailable_results ?? 0}
                    best={bestCost.has(row.id)}
                  />
                </TableCell>
                <TableCell className="min-w-44">
                  {row.security?.total_tests === 0 || !row.security ? (
                    <span className="text-muted-foreground">No security tests</span>
                  ) : (
                    <ScoreCell
                      primary={row.security.score}
                      unavailable={row.security.unavailable_tests}
                      best={bestSecurity.has(row.id)}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <ComparisonProfilePlot rows={rows} entity={entity} />
    </section>
  )
}

function ComparisonProfilePlot({ rows, entity }: {
  rows: ComparisonRow[]
  entity: "Model" | "Prompt version"
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const axes = profileAxes(rows)
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
  const x = (index: number) => 55 + index * 130
  const y = (value: number) => 32 + (1 - value) * 150

  return (
    <Card className="overflow-hidden bg-card text-card-foreground shadow-sm">
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{entity} performance constellation</CardTitle>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            A relative profile within this run. Higher positions are better;
            latency, token use, and cost are inverted. Exact values remain in the table.
          </p>
        </div>
        <Badge className="w-fit" variant="outline">
          Same dataset · same run
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-xl border bg-muted/30 p-3">
          <svg
            viewBox="0 0 630 225"
            className="min-w-[620px]"
            role="img"
            aria-label={`Relative ${entity.toLowerCase()} profile across quality, latency, token use, cost, and security`}
          >
            <rect x="35" y="24" width="560" height="166" rx="12" fill="var(--card)" />
            {[0, 0.5, 1].map((tick) => (
              <line key={tick} x1="35" x2="595" y1={y(tick)} y2={y(tick)} stroke="var(--foreground)" strokeOpacity="0.12" strokeDasharray="4 5" />
            ))}
            {axes.map((axis, index) => (
              <g key={axis.label}>
                <line x1={x(index)} x2={x(index)} y1="32" y2="182" stroke="var(--foreground)" strokeOpacity="0.16" />
                <text x={x(index)} y="211" fill="var(--muted-foreground)" fontSize="11" textAnchor="middle">{axis.label}</text>
              </g>
            ))}
            {rows.map((row, rowIndex) => {
              const points = axes.map((axis, index) => {
                const value = axis.value(row)
                return value === null ? null : `${x(index)},${y(value)}`
              })
              const visible = highlighted === null || highlighted === row.id
              return (
                <g key={row.id} opacity={visible ? 1 : 0.18}>
                  {profileSegments(points).map((segment, index) => (
                    <polyline key={index} points={segment} fill="none" stroke={colors[rowIndex % colors.length]} strokeWidth={highlighted === row.id ? 4 : 2.5} strokeLinejoin="round" />
                  ))}
                  {points.map((point, index) => point && (
                    <circle key={axes[index].label} cx={Number(point.split(",")[0])} cy={Number(point.split(",")[1])} r={highlighted === row.id ? 5 : 3.5} fill={colors[rowIndex % colors.length]} stroke="var(--card)" strokeWidth="2" />
                  ))}
                </g>
              )
            })}
          </svg>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label={`Highlight ${entity.toLowerCase()}`}>
          {rows.map((row, index) => (
            <button
              key={row.id}
              type="button"
              aria-pressed={highlighted === row.id}
              onClick={() => setHighlighted((current) => current === row.id ? null : row.id)}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
              {row.name}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function MetricCard({ icon: Icon, label, value, detail }: {
  icon: typeof BarChart3
  label: string
  value: string
  detail: string
}) {
  return (
    <Card className="gap-4">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
        <span className="rounded-lg bg-muted p-2"><Icon className="size-4" /></span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function ScoreCell({ primary, secondary, unavailable, best = false }: {
  primary: number | null
  secondary?: string
  unavailable: number
  best?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-medium">{formatPercent(primary)}</span>
        {best && <Badge className="gap-1"><Trophy className="size-3" /> Best</Badge>}
      </div>
      {primary !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-brand" style={{ width: `${primary * 100}%` }} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {[secondary, unavailable > 0 ? `${unavailable} unavailable` : null]
          .filter(Boolean)
          .join(" · ") || "Complete data"}
      </p>
    </div>
  )
}

function ValueCell({ value, unavailable, best = false }: {
  value: string
  unavailable: number
  best?: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="font-medium">{value}</span>
        {best && <Badge className="gap-1"><Trophy className="size-3" /> Best</Badge>}
      </div>
      {unavailable > 0 && <p className="text-xs text-muted-foreground">{unavailable} unavailable</p>}
    </div>
  )
}

function ActiveRuns({ runs }: { runs: EvaluationRun[] }) {
  return (
    <Card className="gap-3">
      <CardHeader><CardTitle className="text-sm">Active evaluations</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {runs.map((run) => (
          <Link key={run.id} to={`/evaluations/${run.id}`} className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted">
            <LoaderCircle className="size-4 animate-spin" /> {run.dataset_name} · {run.completed_requests}/{run.total_requests}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

function ActiveRun({ run }: { run: EvaluationRun }) {
  return (
    <Card><CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="font-medium">This evaluation is still running.</p><p className="mt-1 text-sm text-muted-foreground">Open the run page for live progress and individual results.</p></div>
      <Link to={`/evaluations/${run.id}`} className={buttonVariants()}>View progress <ArrowRight className="size-4" /></Link>
    </CardContent></Card>
  )
}

function EmptyDashboard({ activeRuns }: { activeRuns: EvaluationRun[] }) {
  return (
    <div className="space-y-6">
      <Card className="items-center py-14 text-center">
        <CardContent className="max-w-lg">
          <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl bg-muted"><BarChart3 className="size-6" /></span>
          <h1 className="text-2xl font-semibold">No completed evaluations yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">Run an evaluation to compare quality, performance, cost, and security in one place.</p>
          <Link to="/evaluations/new" className={cn(buttonVariants(), "mt-6")}>New evaluation <FlaskConical className="size-4" /></Link>
        </CardContent>
      </Card>
      {activeRuns.length > 0 && <ActiveRuns runs={activeRuns} />}
    </div>
  )
}

function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`flex items-center justify-center gap-3 text-sm text-muted-foreground ${compact ? "py-8" : "min-h-72"}`}><LoaderCircle className="size-5 animate-spin" /> {label}</div>
}

function InlineError({ message }: { message: string }) {
  return <p className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="size-4" /> {message}</p>
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Card><CardContent className="flex flex-col items-start gap-4"><InlineError message={message} /><Button type="button" onClick={onRetry}><RefreshCw className="size-4" />Retry</Button></CardContent></Card>
}

function RunStatus({ status }: { status: EvaluationRun["status"] }) {
  return <Badge variant="outline">{status[0].toUpperCase() + status.slice(1)}</Badge>
}

function RunFact({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>
}

function isTerminal(run: EvaluationRun) {
  return run.status === "completed" || run.status === "failed"
}

function runOption(run: EvaluationRun) {
  return `${run.dataset_name} · ${formatDate(run.completed_at ?? run.created_at)} · ${run.status}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "Unavailable" : `${Math.round(value * 100)}%`
}

function formatLatency(value: number | null | undefined) {
  return value === null || value === undefined ? "Unavailable" : `${Math.round(value).toLocaleString()} ms`
}

function formatInteger(value: number | null | undefined) {
  return value === null || value === undefined ? "Unavailable" : value.toLocaleString()
}

function formatCost(value: string | null | undefined) {
  if (value === null || value === undefined) return "Unavailable"
  return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(value))} USD`
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
  return [...models].map(([id, name]) => ({
    id,
    name,
    contains: contains?.by_model.find((item) => item.model_id === id),
    exact: exact?.by_model.find((item) => item.model_id === id),
    latency: summaries.performance.latency_by_model.find((item) => item.model_id === id),
    tokens: summaries.performance.token_usage_by_model.find((item) => item.model_id === id),
    cost: summaries.cost.by_model.find((item) => item.model_id === id),
    security: summaries.security.by_model.find((item) => item.model_id === id),
  })).sort((a, b) => a.name.localeCompare(b.name))
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
      exact: exact?.by_prompt_version.find((item) => item.prompt_version_id === id),
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

function profileAxes(rows: ComparisonRow[]) {
  const latencyValues = rows.flatMap((row) => nullableValue(completeLatency(row.latency)))
  const tokenValues = rows.flatMap((row) =>
    nullableValue(
      row.tokens?.total_tokens.sum_tokens !== null &&
        row.tokens?.total_tokens.sum_tokens !== undefined &&
        row.tokens.total_tokens.unavailable_results === 0
        ? row.tokens.total_tokens.sum_tokens
        : null,
    ),
  )
  const costValues = rows.flatMap((row) => nullableValue(completeCost(row.cost)))
  return [
    { label: "Quality", value: (row: ComparisonRow) => completeScore(row.contains) },
    {
      label: "Latency",
      value: (row: ComparisonRow) => relativeProfile(completeLatency(row.latency), latencyValues),
    },
    {
      label: "Token use",
      value: (row: ComparisonRow) => relativeProfile(
        row.tokens?.total_tokens.sum_tokens !== null &&
          row.tokens?.total_tokens.sum_tokens !== undefined &&
          row.tokens.total_tokens.unavailable_results === 0
          ? row.tokens.total_tokens.sum_tokens
          : null,
        tokenValues,
      ),
    },
    {
      label: "Cost",
      value: (row: ComparisonRow) => relativeProfile(completeCost(row.cost), costValues),
    },
    { label: "Security", value: (row: ComparisonRow) => completeSecurity(row.security) },
  ]
}

function nullableValue(value: number | null) {
  return value === null ? [] : [value]
}

function relativeProfile(value: number | null, values: number[]) {
  if (value === null || values.length === 0) return null
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  if (minimum === maximum) return 0.5
  return 1 - (value - minimum) / (maximum - minimum)
}

function profileSegments(points: (string | null)[]) {
  const segments: string[] = []
  let current: string[] = []
  for (const point of points) {
    if (point) {
      current.push(point)
    } else {
      if (current.length > 1) segments.push(current.join(" "))
      current = []
    }
  }
  if (current.length > 1) segments.push(current.join(" "))
  return segments
}

function completeScore(value: QualityAggregate | undefined) {
  return value?.average_score !== null && value?.average_score !== undefined && value.unavailable_results === 0 ? value.average_score : null
}

function completeLatency(value: ComparisonRow["latency"]) {
  return value?.average_ms !== null && value?.average_ms !== undefined && value.unavailable_results === 0 ? value.average_ms : null
}

function completeCost(value: ComparisonRow["cost"]) {
  return value?.estimated_usd !== null && value?.estimated_usd !== undefined && value.unavailable_results === 0 ? Number(value.estimated_usd) : null
}

function completeSecurity(value: ComparisonRow["security"]) {
  return value?.score !== null && value?.score !== undefined && value.total_tests > 0 && value.unavailable_tests === 0 ? value.score : null
}

function bestIds(rows: ComparisonRow[], value: (row: ComparisonRow) => number | null, direction: "min" | "max") {
  const candidates = rows.flatMap((row) => {
    const score = value(row)
    return score === null || !Number.isFinite(score) ? [] : [{ id: row.id, score }]
  })
  if (candidates.length === 0) return new Set<string>()
  const best = Math[direction](...candidates.map((item) => item.score))
  return new Set(candidates.filter((item) => item.score === best).map((item) => item.id))
}
