import { Check, Clock3, LoaderCircle, X } from "lucide-react"
import { Fragment, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"

import {
  getPastEvaluations,
  type EvaluationRunHistory,
  type EvaluationRunPage,
} from "@/api/evaluations"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SplitBar } from "@/components/ui/meter"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import {
  Table,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, formatInt, formatShortDate } from "@/lib/format"

const PAGE_SIZE = 20
const statuses = ["all", "completed", "running", "failed"] as const

export function EvaluationHistoryPage() {
  const [pages, setPages] = useState<EvaluationRunHistory[][]>([])
  const [page, setPage] = useState<EvaluationRunPage | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [status, setStatus] = useState("all")
  const [search, setSearch] = useState("")
  const [dataset, setDataset] = useState("")
  const [model, setModel] = useState("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const generation = useRef(0)
  const loadingMore = useRef(false)
  const retryAdvance = useRef(false)

  useEffect(() => {
    const request = ++generation.current
    setIsLoading(true)
    getPastEvaluations(0, PAGE_SIZE)
      .then((result) => {
        if (request !== generation.current) return
        setPages([result.items])
        setPage(result)
        setPageIndex(0)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (request === generation.current) setError(errorMessage(caught))
      })
      .finally(() => {
        if (request === generation.current) setIsLoading(false)
      })
    return () => {
      generation.current += 1
    }
  }, [retryKey])

  const runs = pages.flat()
  const hasMore = page !== null && runs.length < page.total
  async function loadMore(advance = false) {
    if (!page || loadingMore.current) return
    const request = generation.current
    retryAdvance.current = advance
    loadingMore.current = true
    setIsLoadingMore(true)
    try {
      const next = await getPastEvaluations(runs.length, PAGE_SIZE)
      if (request !== generation.current) return
      setPages((current) => [...current, next.items])
      setPage(next)
      if (advance) setPageIndex(pages.length)
      retryAdvance.current = false
      setError(null)
    } catch (caught) {
      if (request === generation.current) setError(errorMessage(caught))
    } finally {
      loadingMore.current = false
      if (request === generation.current) setIsLoadingMore(false)
    }
  }

  function clearFilters() {
    setStatus("all")
    setSearch("")
    setDataset("")
    setModel("")
  }
  const matches = (run: EvaluationRunHistory) =>
    (status === "all" ||
      (status === "running"
        ? run.status === "running" || run.status === "pending"
        : run.status === status)) &&
    `${run.dataset_name} evaluation ${run.id}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()) &&
    (!dataset || run.dataset_id === dataset) &&
    (!model || run.models.some((item) => item.id === model))
  const desktopRuns = (pages[pageIndex] ?? []).filter(matches)
  const mobileRuns = runs.filter(matches)
  const datasets = Array.from(
    new Map(runs.map((run) => [run.dataset_id, run.dataset_name])),
  )
  const models = Array.from(
    new Map(
      runs.flatMap((run) =>
        run.models.map((item) => [item.id, item.name] as const),
      ),
    ),
  )
  const filterFields = (prefix: string) => (
    <>
      <label
        className="min-w-0 space-y-1 text-caption"
        htmlFor={`${prefix}-dataset`}
      >
        Dataset
        <Select
          id={`${prefix}-dataset`}
          value={dataset}
          onChange={(event) => setDataset(event.target.value)}
        >
          <option value="">All datasets</option>
          {datasets.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </label>
      <label
        className="min-w-0 space-y-1 text-caption"
        htmlFor={`${prefix}-model`}
      >
        Model
        <Select
          id={`${prefix}-model`}
          value={model}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="">All models</option>
          {models.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </label>
    </>
  )
  const offset = pages
    .slice(0, pageIndex)
    .reduce((total, items) => total + items.length, 0)
  const counts = [
    page?.total,
    page?.completed,
    page ? page.total - page.completed - page.failed : undefined,
    page?.failed,
  ]
  const noMatches = (
    <EmptyState
      title={
        <span role="heading" aria-level={2}>
          No runs match
        </span>
      }
      description="Try another filter or clear your selection."
      action={
        <Button
          variant="outline"
          className="max-md:min-h-11"
          onClick={clearFilters}
        >
          Clear filters
        </Button>
      }
    />
  )

  return (
    <PageFrame
      breadcrumbs={[{ label: "Runs" }]}
      mobileTitle="Runs"
      actions={
        <span className="text-caption text-fg-muted">
          Runs are immutable snapshots of the models, prompt versions and data
          used.
        </span>
      }
      mobileAction={
        <Link
          to="/evaluations/new"
          className={buttonVariants({ size: "touch" })}
        >
          New
        </Link>
      }
    >
      <PageHeader title="Runs" />
      <div className="flex flex-wrap items-end gap-3">
        <SegmentedControl
          className="max-md:[&_button]:flex-col max-md:[&_button]:gap-0"
          label="Filter by status"
          value={status}
          onValueChange={setStatus}
          options={statuses.map((value, index) => ({
            value,
            label: ["All", "Completed", "Running", "Failed"][index],
            count: counts[index],
            id: `runs-${value}-tab`,
            panelId: "runs-panel",
          }))}
        />
        <div
          role="search"
          className="flex min-w-0 flex-1 items-end gap-2 md:ml-auto"
        >
          <label
            htmlFor="runs-search"
            className="min-w-0 flex-1 space-y-1 text-caption"
          >
            Search runs
            <Input
              id="runs-search"
              className="h-11 md:h-9"
              type="search"
              placeholder="Name or run ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Button
            variant="outline"
            className="h-11 md:hidden"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(true)}
          >
            Filters
          </Button>
        </div>
        <div className="hidden min-w-0 grid-cols-2 gap-2 md:grid md:w-72">
          {filterFields("desktop")}
        </div>
      </div>
      {page && runs.length > 0 && (
        <>
          <p className="hidden text-caption text-fg-muted md:block">
            Filters apply to this page only (
            {formatInt(pages[pageIndex]?.length ?? 0)} of{" "}
            {formatInt(page.total)} runs).
            {(hasMore || pages.length > 1) &&
              " Use Previous or Next to search another page."}
          </p>
          <p className="text-caption text-fg-muted md:hidden">
            Filters apply to loaded results only ({formatInt(runs.length)} of{" "}
            {formatInt(page.total)} loaded).
            {hasMore && " Load more history to search older runs."}
          </p>
        </>
      )}
      <Dialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filter runs"
        footer={
          <Button onClick={() => setFiltersOpen(false)}>Show results</Button>
        }
      >
        {filterFields("mobile")}
        <Button variant="ghost" onClick={clearFilters}>
          Clear filters
        </Button>
      </Dialog>
      <div
        id="runs-panel"
        role="tabpanel"
        aria-labelledby={`runs-${status}-tab`}
        tabIndex={0}
        className="space-y-3"
      >
        {isLoading && <LoadingState label="Loading history…" rows={5} />}
        {error && (
          <ErrorState
            message={error}
            retrying={isLoading || isLoadingMore}
            onRetry={() => {
              if (pages.length) void loadMore(retryAdvance.current)
              else setRetryKey((value) => value + 1)
            }}
          />
        )}
        {!isLoading && !error && runs.length === 0 && (
          <Card>
            <EmptyState
              title={
                <span role="heading" aria-level={2}>
                  No evaluations yet
                </span>
              }
              description="Create a run to start the persistent history."
              action={
                <Link
                  to="/evaluations/new"
                  className={`${buttonVariants()} max-md:min-h-11`}
                >
                  New evaluation
                </Link>
              }
            />
          </Card>
        )}
        {runs.length > 0 && (
          <>
            <Card
              className="hidden gap-0 overflow-hidden py-0 md:flex"
              data-testid="runs-table"
            >
              {desktopRuns.length === 0 ? (
                noMatches
              ) : (
                <Table aria-label="Saved runs" className="min-w-[960px]">
                  <TableHeader>
                    <TableRow>
                      {[
                        "Started",
                        "Run",
                        "Models",
                        "Prompt versions",
                        "Requests",
                        "Status",
                        "Actions",
                      ].map((label) => (
                        <TableHead
                          key={label}
                          className={
                            label === "Requests" ? "text-right" : undefined
                          }
                        >
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupRuns(desktopRuns).map(([month, items]) => (
                      <Fragment key={month}>
                        <TableGroupRow colSpan={7}>{month}</TableGroupRow>
                        {items.map((run) => (
                          <TableRow key={run.id}>
                            <TableCell className="whitespace-pre-line font-mono text-fg-muted">
                              {formatShortDate(run.created_at)}
                            </TableCell>
                            <TableCell className="min-w-40 max-w-64">
                              <RunName run={run} />
                              <RunId run={run} />
                            </TableCell>
                            <TableCell className="max-w-44">
                              <Snapshots
                                values={run.models.map((item) => item.name)}
                              />
                            </TableCell>
                            <TableCell className="max-w-48">
                              {run.prompt_versions.length > 2 && (
                                <p className="font-mono">
                                  {formatInt(run.prompt_versions.length)}{" "}
                                  versions
                                </p>
                              )}
                              <Snapshots
                                values={run.prompt_versions.map(
                                  (item) =>
                                    `${item.name} · v${item.version_number}`,
                                )}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Requests run={run} />
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={run.status} />
                            </TableCell>
                            <TableCell>
                              <RunActions run={run} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-caption text-fg-muted">
                <span className="font-mono">
                  {formatInt(runs.length ? offset + 1 : 0)}–
                  {formatInt(offset + (pages[pageIndex]?.length ?? 0))} of{" "}
                  {formatInt(page?.total)}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={pageIndex === 0 || isLoadingMore}
                    onClick={() => setPageIndex((value) => value - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={
                      isLoadingMore ||
                      (pageIndex === pages.length - 1 && !hasMore)
                    }
                    onClick={() => {
                      if (pageIndex < pages.length - 1)
                        setPageIndex((value) => value + 1)
                      else void loadMore(true)
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </Card>
            <div className="space-y-3 md:hidden" data-testid="runs-cards">
              {mobileRuns.length === 0
                ? noMatches
                : groupRuns(mobileRuns).map(([month, items]) => (
                    <section
                      key={month}
                      className="space-y-3"
                      aria-label={month}
                    >
                      <h2 className="text-overline uppercase text-fg-muted">
                        {month}
                      </h2>
                      {items.map((run) => (
                        <Card key={run.id} className="gap-2.5 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <RunName run={run} />
                              <RunId run={run} />
                              <p className="font-mono text-data-sm text-fg-muted">
                                {formatDateTime(run.created_at)}
                              </p>
                            </div>
                            <StatusBadge status={run.status} />
                          </div>
                          <div className="text-caption text-fg-secondary">
                            <Snapshots
                              compact
                              values={run.models.map((item) => item.name)}
                            />
                            <span aria-hidden="true"> · </span>
                            <Snapshots
                              compact
                              values={run.prompt_versions.map(
                                (item) =>
                                  `${item.name} · v${item.version_number}`,
                              )}
                            />
                          </div>
                          <Requests run={run} />
                          <RunActions run={run} mobile />
                        </Card>
                      ))}
                    </section>
                  ))}
              {hasMore && (
                <Button
                  variant="outline"
                  className="h-11 w-full"
                  disabled={isLoadingMore}
                  onClick={() => void loadMore()}
                >
                  {isLoadingMore
                    ? "Loading…"
                    : `Load ${formatInt(Math.min(PAGE_SIZE, (page?.total ?? 0) - runs.length))} more`}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </PageFrame>
  )
}

function groupRuns(
  runs: EvaluationRunHistory[],
): [string, EvaluationRunHistory[]][] {
  const groups = new Map<string, EvaluationRunHistory[]>()
  for (const run of runs) {
    const date = new Date(run.created_at)
    const month = Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("en-US", {
          month: "long",
          year: "numeric",
        }).format(date)
      : "Unknown date"
    groups.set(month, [...(groups.get(month) ?? []), run])
  }
  return Array.from(groups)
}
function RunName({ run }: { run: EvaluationRunHistory }) {
  return (
    <Link
      to={`/evaluations/${run.id}`}
      className="font-sans text-body font-medium text-link [overflow-wrap:anywhere] max-md:inline-flex max-md:min-h-11 max-md:items-center"
    >
      {run.dataset_name} evaluation
    </Link>
  )
}
function RunId({ run }: { run: EvaluationRunHistory }) {
  return (
    <p title={run.id} className="font-mono text-data-sm text-fg-muted">
      {run.id.slice(0, 8).toLowerCase()}
      {run.repetitions > 1 && ` · ${formatInt(run.repetitions)} repetitions`}
    </p>
  )
}
function Snapshots({
  values,
  compact = false,
}: {
  values: string[]
  compact?: boolean
}) {
  return (
    <div
      className={
        compact
          ? "inline font-sans text-caption text-fg-secondary [overflow-wrap:anywhere]"
          : "font-sans text-caption text-fg-secondary [overflow-wrap:anywhere]"
      }
    >
      {values.length ? (
        values.map((value, index) => (
          <Fragment key={`${index}-${value}`}>
            {compact && index > 0 && " · "}
            <p className={compact ? "inline" : undefined}>
              {/ · v\d+$/.test(value) ? (
                <>
                  {value.replace(/v\d+$/, "")}
                  <span className="font-mono">{value.match(/v\d+$/)?.[0]}</span>
                </>
              ) : (
                value
              )}
            </p>
          </Fragment>
        ))
      ) : (
        <p className={compact ? "inline text-fg-muted" : "text-fg-muted"}>
          Unavailable for this historical run
        </p>
      )}
    </div>
  )
}
function Requests({ run }: { run: EvaluationRunHistory }) {
  return (
    <div className="space-y-1 font-mono text-data">
      <span
        aria-label={`${formatInt(run.successful_requests)} successful of ${formatInt(run.total_requests)} requests`}
      >
        {formatInt(run.successful_requests)}/{formatInt(run.total_requests)}
      </span>
      <SplitBar
        className="ml-auto w-16 max-md:w-full"
        aria-label="Request outcomes"
        segments={[
          { value: run.successful_requests, tone: "success" },
          { value: run.failed_requests, tone: "destructive" },
          {
            value: Math.max(
              0,
              run.total_requests -
                run.successful_requests -
                run.failed_requests,
            ),
            tone: "line",
          },
        ]}
      />
      <p
        className={
          run.failed_requests
            ? "text-data-sm text-destructive"
            : "text-data-sm text-fg-muted"
        }
      >
        {run.failed_requests > 0 && "✕ "}
        {formatInt(run.failed_requests)} failed
      </p>
    </div>
  )
}
function RunActions({
  run,
  mobile = false,
}: {
  run: EvaluationRunHistory
  mobile?: boolean
}) {
  return (
    <div className={mobile ? "grid grid-cols-2 gap-2" : "flex gap-1"}>
      {(run.status === "completed" || run.status === "failed") && (
        <Link
          to={`/?run=${run.id}`}
          className={buttonVariants({
            variant: "ghost",
            size: mobile ? "touch" : "xs",
          })}
        >
          Compare
        </Link>
      )}
      <Link
        to={`/evaluations/${run.id}`}
        className={buttonVariants({
          variant: "outline",
          size: mobile ? "touch" : "xs",
        })}
      >
        {mobile ? "Open results" : "Open"}
      </Link>
    </div>
  )
}
function StatusBadge({ status }: { status: EvaluationRunHistory["status"] }) {
  const Icon =
    status === "completed"
      ? Check
      : status === "failed"
        ? X
        : status === "running"
          ? LoaderCircle
          : Clock3
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
      <Icon
        aria-hidden="true"
        className={
          status === "running"
            ? "size-3 animate-spin motion-reduce:animate-none"
            : "size-3"
        }
      />
      {status[0].toUpperCase() + status.slice(1)}
    </Badge>
  )
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Could not load evaluation history."
}
