import { FileUp } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import {
  commitDatasetImport,
  getDatasetsForImport,
  previewDatasetImport,
  type ImportOptions,
  type ImportPreview,
  type ImportRow
} from "@/api/dataset-import"
import type { DatasetSummary } from "@/api/datasets"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { MetricCell } from "@/components/ui/metric-strip"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { StepPanel } from "@/components/ui/step-panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { formatInt } from "@/lib/format"

const targets = [
  { key: "input", label: "Input", required: true },
  { key: "expected_answer", label: "Expected answer", required: true },
  { key: "case_type", label: "Case type" },
  { key: "security_test_type", label: "Security test type" },
  { key: "category", label: "Category" },
  { key: "metadata", label: "Metadata" }
]
const ROWS_PER_PAGE = 25
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

type PreviewSnapshot = {
  file: File
  optionsKey: string
  requestedDataset: string
  generation: number
  result: ImportPreview
}

export function DatasetImportPage() {
  const [params] = useSearchParams()
  const requestedDataset = params.get("dataset") ?? ""
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [datasetsLoading, setDatasetsLoading] = useState(true)
  const [datasetsError, setDatasetsError] = useState<string | null>(null)
  const [datasetsRetry, setDatasetsRetry] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [draft, setDraft] = useState<ImportOptions>({
    destination: requestedDataset
      ? { mode: "existing", dataset_id: requestedDataset }
      : { mode: "new", name: "", description: null },
    mapping: {},
    invalid_policy: "strict",
    duplicate_action: "skip"
  })
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [page, setPage] = useState(0)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [committing, setCommitting] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const generation = useRef(0)
  const mounted = useRef(false)
  const commitLock = useRef(false)
  const importAttempt = useRef<{
    file: File
    optionsKey: string
    fingerprint: string
    id: string
  } | null>(null)
  const nameEdited = useRef(false)
  const descriptionEdited = useRef(false)
  const suggestedFile = useRef<File | null>(null)
  const newDestination = useRef<{ mode: "new"; name: string; description: string | null }>({
    mode: "new",
    name: "",
    description: null
  })
  const existingDestination = useRef(requestedDataset)
  const chooser = useRef<HTMLInputElement>(null)
  const optionsKey = JSON.stringify(draft)

  function invalidate() {
    generation.current += 1
    importAttempt.current = null
    setSnapshot(null)
    setPreviewError(null)
    setCommitError(null)
    setPage(0)
  }
  function refreshPreview() {
    if (commitLock.current) return
    generation.current += 1
    setSnapshot(null)
    setPreviewError(null)
    setCommitError(null)
    setPage(0)
    setRetry((value) => value + 1)
  }
  function changeDraft(next: ImportOptions) {
    if (commitLock.current) return
    invalidate()
    if (next.destination.mode === "new") newDestination.current = next.destination
    else existingDestination.current = next.destination.dataset_id
    setDraft(next)
  }
  function chooseFile(next: File | null) {
    if (!next || commitLock.current) return
    invalidate()
    setColumns([])
    setFileError(null)
    suggestedFile.current = null
    if (!/\.(csv|json)$/i.test(next.name)) {
      setFile(null)
      setFileError("Choose a CSV or JSON file.")
      return
    }
    setFile(next)
    if (!nameEdited.current)
      newDestination.current = {
        ...newDestination.current,
        name: next.name.replace(/\.(csv|json)$/i, "").trim() || "Imported dataset"
      }
    setDraft({
      ...draft,
      mapping: {},
      destination: draft.destination.mode === "new" ? newDestination.current : draft.destination
    })
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
    }
  }, [])
  useEffect(() => {
    let active = true
    void getDatasetsForImport()
      .then((result) => {
        if (active) {
          setDatasets(result)
          setDatasetsLoading(false)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setDatasetsError(messageOf(error, "Could not load datasets."))
          setDatasetsLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [datasetsRetry])
  useEffect(() => {
    generation.current += 1
    importAttempt.current = null
    setSnapshot(null)
    setPreviewError(null)
    setCommitError(null)
    existingDestination.current = requestedDataset
    setDraft((previous) => ({
      ...previous,
      destination: requestedDataset
        ? { mode: "existing", dataset_id: requestedDataset }
        : newDestination.current
    }))
  }, [requestedDataset])
  useEffect(() => {
    if (!file) return
    let active = true
    const requestGeneration = generation.current
    const sentOptions = JSON.parse(optionsKey) as ImportOptions
    const timer = window.setTimeout(() => {
      void previewDatasetImport(file, sentOptions)
        .then((result) => {
          if (!active || generation.current !== requestGeneration || !mounted.current) return
          setColumns(result.source_columns)
          const next = { ...sentOptions }
          if (Object.keys(sentOptions.mapping).length === 0) next.mapping = result.mapping
          if (suggestedFile.current !== file) {
            suggestedFile.current = file
            if (next.destination.mode === "new" && result.dataset_suggestion) {
              next.destination = {
                ...next.destination,
                name:
                  !nameEdited.current && result.dataset_suggestion.name
                    ? result.dataset_suggestion.name
                    : next.destination.name,
                description:
                  !descriptionEdited.current && result.dataset_suggestion.description !== undefined
                    ? result.dataset_suggestion.description
                    : next.destination.description
              }
            }
          }
          if (JSON.stringify(next) !== optionsKey) {
            generation.current += 1
            if (next.destination.mode === "new") newDestination.current = next.destination
            setDraft(next)
            return
          }
          setSnapshot({ file, optionsKey, requestedDataset, generation: requestGeneration, result })
          setPage(0)
        })
        .catch((error: unknown) => {
          if (active && generation.current === requestGeneration && mounted.current)
            setPreviewError(messageOf(error, "Could not preview the file."))
        })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [file, optionsKey, requestedDataset, retry])

  const preview =
    snapshot?.file === file &&
    snapshot.optionsKey === optionsKey &&
    snapshot.requestedDataset === requestedDataset &&
    snapshot.generation === generation.current
      ? snapshot.result
      : null
  const updating = Boolean(file && !preview && !previewError)
  const counts = preview?.counts
  const writeCount = counts ? counts.add + counts.replace : undefined
  const destination = draft.destination
  const missingDataset =
    destination.mode === "existing" &&
    !datasetsLoading &&
    !datasetsError &&
    !datasets.some((item) => item.id === destination.dataset_id)
  const canImport = Boolean(
    preview?.can_commit &&
    preview.fingerprint &&
    !committing &&
    !missingDataset &&
    (destination.mode === "new" || (!datasetsLoading && !datasetsError))
  )
  async function commit() {
    if (
      commitLock.current ||
      !canImport ||
      !file ||
      !preview?.fingerprint ||
      !snapshot ||
      snapshot.generation !== generation.current
    )
      return
    commitLock.current = true
    const commitGeneration = generation.current
    setCommitting(true)
    setCommitError(null)
    try {
      if (
        !importAttempt.current ||
        importAttempt.current.file !== file ||
        importAttempt.current.optionsKey !== optionsKey ||
        importAttempt.current.fingerprint !== preview.fingerprint
      ) {
        importAttempt.current = {
          file,
          optionsKey,
          fingerprint: preview.fingerprint,
          id: crypto.randomUUID()
        }
      }
      const result = await commitDatasetImport(
        file,
        draft,
        preview.fingerprint,
        importAttempt.current.id
      )
      if (mounted.current && generation.current === commitGeneration)
        navigate(`/datasets/${result.dataset_id}`)
    } catch (error: unknown) {
      if (mounted.current && generation.current === commitGeneration)
        setCommitError(messageOf(error, "Could not import the file."))
    } finally {
      commitLock.current = false
      if (mounted.current) setCommitting(false)
    }
  }
  const mappingFields = (
    <div className="grid min-w-0 gap-3 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
      {targets.map((target) => (
        <Field
          key={target.key}
          label={
            <>
              {target.label}
              {target.required && <span className="text-destructive"> · required</span>}
            </>
          }
          optional={!target.required}
        >
          <Select
            className="min-w-0 font-mono max-md:h-11 max-md:text-[14px]"
            value={draft.mapping[target.key] ?? ""}
            disabled={!file || committing || !columns.length}
            onChange={(event) =>
              changeDraft({
                ...draft,
                mapping: { ...draft.mapping, [target.key]: event.target.value || null }
              })
            }
          >
            <option value="">Ignore</option>
            {columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </Select>
        </Field>
      ))}
    </div>
  )
  const fileIssues =
    preview?.issues.filter(
      (issue) => !preview.rows.some((row) => row.row_number === issue.row_number)
    ) ?? []

  return (
    <PageFrame
      breadcrumbs={[{ label: "Datasets", to: "/datasets" }, { label: "import" }]}
      mobileTitle="Datasets"
      mobileBack={{ label: "Datasets", to: "/datasets" }}
    >
      <PageHeader
        title="Import dataset"
        description="Upload a CSV or JSON file. The preview updates as you change the file, mapping or rules; nothing is saved until you import."
      />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-1">
          <StepPanel
            step={1}
            title="File and destination"
            disabled={committing}
            contentClassName="space-y-4"
          >
            <div
              className="relative flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-dashed border-line-strong bg-inset p-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                chooseFile(event.dataTransfer.files[0] ?? null)
              }}
            >
              <FileUp aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {file ? (
                  <>
                    <p className="font-mono text-data">{file.name}</p>
                    <p className="font-mono text-caption text-fg-muted">
                      {file.name.toLowerCase().endsWith(".csv") ? "CSV" : "JSON"}
                      {preview
                        ? `${preview.rows.length ? ` · ${formatInt(preview.rows.length)} data ${preview.rows.length === 1 ? "row" : "rows"}` : ""} · ${formatInt(preview.source_columns.length)} ${preview.source_columns.length === 1 ? "column" : "columns"} detected`
                        : updating
                          ? " · Updating preview…"
                          : " · Preview unavailable"}
                    </p>
                  </>
                ) : (
                  <p className="text-body text-fg-muted">
                    Drop a CSV or JSON file here, or choose one
                  </p>
                )}
              </div>
              <label htmlFor="import-file" className="sr-only">
                Choose a CSV or JSON file
              </label>
              <input
                ref={chooser}
                id="import-file"
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="sr-only"
                tabIndex={-1}
                disabled={committing}
                onChange={(event) => {
                  chooseFile(event.target.files?.[0] ?? null)
                  event.target.value = ""
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="relative max-md:h-11"
                onClick={() => chooser.current?.click()}
              >
                {file ? "Choose another file" : "Choose file"}
              </Button>
            </div>
            {fileError && <ErrorState message={fileError} />}
            {previewError && <ErrorState message={previewError} onRetry={refreshPreview} />}
            {fileIssues.length > 0 && (
              <Alert variant="destructive">
                <ul className="min-w-0 [overflow-wrap:anywhere]">
                  {fileIssues.map((issue, index) => (
                    <li key={index}>{issue.message}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {file?.name.toLowerCase().endsWith(".csv") && (
              <Field label="Delimiter" hint="The default CSV delimiter is a comma.">
                <Select
                  value={draft.delimiter ?? ""}
                  className="max-md:h-11 max-md:text-[14px]"
                  onChange={(event) =>
                    changeDraft({ ...draft, delimiter: event.target.value || undefined })
                  }
                >
                  <option value="">Default (comma)</option>
                  <option value=",">Comma</option>
                  <option value=";">Semicolon</option>
                  <option value={"\t"}>Tab</option>
                  <option value="|">Pipe</option>
                </Select>
              </Field>
            )}
            <SegmentedControl
              mode="radio"
              label="Destination"
              value={destination.mode}
              options={[
                { value: "new", label: "New dataset" },
                { value: "existing", label: "Add to existing" }
              ]}
              onValueChange={(value) =>
                changeDraft({
                  ...draft,
                  destination:
                    value === "new"
                      ? newDestination.current
                      : { mode: "existing", dataset_id: existingDestination.current }
                })
              }
            />
            {destination.mode === "new" ? (
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                <Field label="Dataset name">
                  <Input
                    value={destination.name}
                    className="max-md:h-11 max-md:text-[14px]"
                    onChange={(event) => {
                      nameEdited.current = true
                      changeDraft({
                        ...draft,
                        destination: { ...destination, name: event.target.value }
                      })
                    }}
                  />
                </Field>
                <Field label="Description" optional>
                  <Textarea
                    value={destination.description ?? ""}
                    className="max-md:text-[14px]"
                    onChange={(event) => {
                      descriptionEdited.current = true
                      changeDraft({
                        ...draft,
                        destination: { ...destination, description: event.target.value || null }
                      })
                    }}
                  />
                </Field>
              </div>
            ) : (
              <>
                <Field
                  label="Dataset"
                  error={
                    missingDataset
                      ? destination.dataset_id
                        ? "The selected dataset is not available. Choose another dataset."
                        : "Choose an existing dataset."
                      : undefined
                  }
                >
                  <Select
                    value={destination.dataset_id}
                    disabled={datasetsLoading || Boolean(datasetsError)}
                    className="max-md:h-11 max-md:text-[14px]"
                    onChange={(event) =>
                      changeDraft({
                        ...draft,
                        destination: { mode: "existing", dataset_id: event.target.value }
                      })
                    }
                  >
                    <option value="">
                      {datasetsLoading ? "Loading datasets…" : "Select a dataset"}
                    </option>
                    {missingDataset && destination.dataset_id && (
                      <option value={destination.dataset_id}>Selected dataset unavailable</option>
                    )}
                    {datasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {dataset.name} · {formatInt(dataset.test_case_count)} {dataset.test_case_count === 1 ? "case" : "cases"}
                      </option>
                    ))}
                  </Select>
                </Field>
                {datasetsError && (
                  <ErrorState
                    message={datasetsError}
                    onRetry={() => {
                      setDatasetsError(null)
                      setDatasetsLoading(true)
                      setDatasetsRetry((value) => value + 1)
                    }}
                  />
                )}
                {!datasetsLoading && !datasetsError && !datasets.length && (
                  <EmptyState
                    title="No datasets yet"
                    description="Choose New dataset to create one from this file."
                  />
                )}
              </>
            )}
          </StepPanel>
          <StepPanel
            step={2}
            title="Column mapping"
            caption={
              !file
                ? "Choose a file first"
                : columns.length
                  ? "Matched automatically by column name"
                  : "Waiting for source columns"
            }
            disabled={!file || committing}
            actions={
              <Button
                type="button"
                variant="outline"
                className="relative h-11 md:hidden"
                disabled={!columns.length}
                aria-expanded={mappingOpen}
                aria-controls="import-mapping-dialog-content"
                aria-haspopup="dialog"
                onClick={() => setMappingOpen(true)}
              >
                Edit
              </Button>
            }
          >
            <div className="hidden md:block">{mappingFields}</div>
            <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 text-caption md:hidden">
              {targets.map((target) => (
                <div key={target.key} className="contents">
                  <dt>
                    {target.label}
                    {target.required && <span className="text-destructive"> · required</span>}
                  </dt>
                  <dd className="font-mono text-data [overflow-wrap:anywhere]">
                    {draft.mapping[target.key] ?? "Ignore"}
                  </dd>
                </div>
              ))}
            </dl>
          </StepPanel>
          <StepPanel
            step={3}
            title="Rules"
            caption={!file ? "Choose a file first" : undefined}
            disabled={!file || committing}
            contentClassName="space-y-4"
          >
            <SegmentedControl
              mode="radio"
              label="Invalid rows"
              value={draft.invalid_policy}
              options={[
                { value: "strict", label: "Block import" },
                { value: "valid_only", label: "Import valid rows only" }
              ]}
              onValueChange={(value) =>
                changeDraft({ ...draft, invalid_policy: value as ImportOptions["invalid_policy"] })
              }
            />
            <SegmentedControl
              mode="radio"
              label="Duplicates"
              value={draft.duplicate_action}
              options={[
                { value: "skip", label: "Skip" },
                { value: "replace", label: "Replace" },
                { value: "keep", label: "Keep" }
              ]}
              onValueChange={(value) =>
                changeDraft({
                  ...draft,
                  duplicate_action: value as ImportOptions["duplicate_action"]
                })
              }
            />
          </StepPanel>
        </div>
        <Card className="min-w-0 md:row-start-3 xl:col-span-2 xl:row-start-2">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            {preview && (
              <span className="font-mono text-data text-fg-muted">
                {formatInt(preview.rows.length)} {preview.rows.length === 1 ? "row" : "rows"}
              </span>
            )}
          </CardHeader>
          {updating ? (
            <LoadingState label="Updating preview…" />
          ) : preview ? (
            <PreviewRows preview={preview} page={page} onPageChange={setPage} />
          ) : (
            <EmptyState
              title={
                previewError || fileError ? "Preview unavailable" : "Choose a file to preview rows"
              }
              description={
                previewError || fileError
                  ? "Resolve the file or settings issue above and retry."
                  : "The plan updates automatically as you change settings."
              }
            />
          )}
          <CardFooter>
            {file?.name.toLowerCase().endsWith(".json")
              ? "Row numbers match the JSON objects, starting at 1."
              : "Row numbers match the file (row 1 is the header)."}
          </CardFooter>
        </Card>
        <Card className="min-w-0 self-start md:row-start-2 xl:col-start-2 xl:row-start-1">
          <CardHeader>
            <CardTitle>Import plan</CardTitle>
            <Badge
              variant={
                committing || updating
                  ? "info"
                  : canImport
                    ? "success"
                    : file
                      ? "destructive"
                      : "secondary"
              }
            >
              {committing
                ? "● importing"
                : updating
                  ? "● updating"
                  : canImport
                    ? "✓ ready"
                    : file
                      ? "✕ blocked"
                      : "No file"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-2 text-body">
              {["add", "replace", "unchanged", "skip", "invalid"].map((key) => (
                <div key={key} className="flex justify-between gap-3">
                  <dt
                    className={
                      key === "add"
                        ? "text-success"
                        : key === "invalid" && counts && counts.invalid > 0
                          ? "text-destructive"
                          : "text-fg-secondary"
                    }
                  >
                    {
                      {
                        add: "+ Add",
                        replace: "↻ Replace",
                        unchanged: "= Unchanged",
                        skip: "– Skip",
                        invalid: "✕ Invalid"
                      }[key]
                    }
                  </dt>
                  <dd className="font-mono text-data">{formatInt(counts?.[key])}</dd>
                </div>
              ))}
            </dl>
            <MetricCell
              className="border-t border-line px-0 md:px-0"
              label="Final dataset size"
              value={formatInt(counts?.final)}
            />
            {commitError && (
              <div className="space-y-3">
                <ErrorState message={commitError} />
                <Button
                  type="button"
                  variant="outline"
                  className="relative max-md:h-11"
                  disabled={committing}
                  onClick={refreshPreview}
                >
                  Refresh preview
                </Button>
              </div>
            )}
            <Button
              type="button"
              size="lg"
              className="relative w-full max-md:h-12"
              disabled={!canImport}
              onClick={() => void commit()}
            >
              {committing
                ? "Importing…"
                : updating
                  ? "Updating preview…"
                  : writeCount !== undefined
                    ? `Import ${formatInt(writeCount)} ${writeCount === 1 ? "row" : "rows"}`
                    : "Import rows"}
            </Button>
            <p role="status" className="text-caption text-fg-muted [overflow-wrap:anywhere]">
              {updating
                ? "The import plan is updating. Wait for the current preview."
                : (preview?.message ?? (!file ? "Choose a file first." : undefined))}
            </p>
            <p className="text-caption text-fg-muted">
              Opens the dataset when the import finishes.
            </p>
          </CardContent>
        </Card>
      </div>
      <Dialog
        open={mappingOpen}
        onOpenChange={setMappingOpen}
        title="Column mapping"
        description="Changes update the preview automatically."
        footer={
          <Button type="button" variant="outline" onClick={() => setMappingOpen(false)}>
            Done
          </Button>
        }
      >
        {mappingOpen && (
          <div id="import-mapping-dialog-content" className="space-y-3.5">
            <MappingEditor
              columns={columns}
              mapping={draft.mapping}
              disabled={committing}
              onChange={(mapping) => changeDraft({ ...draft, mapping })}
            />
          </div>
        )}
      </Dialog>
    </PageFrame>
  )
}

function MappingEditor({
  columns,
  mapping,
  disabled,
  onChange
}: {
  columns: string[]
  mapping: ImportOptions["mapping"]
  disabled: boolean
  onChange: (mapping: ImportOptions["mapping"]) => void
}) {
  return (
    <>
      {targets.map((target) => (
        <Field
          key={target.key}
          label={
            <>
              {target.label}
              {target.required && <span className="text-destructive"> · required</span>}
            </>
          }
          optional={!target.required}
        >
          <Select
            disabled={disabled}
            value={mapping[target.key] ?? ""}
            className="font-mono"
            onChange={(event) => onChange({ ...mapping, [target.key]: event.target.value || null })}
          >
            <option value="">Ignore</option>
            {columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </Select>
        </Field>
      ))}
    </>
  )
}

function PlanBadge({ row }: { row: ImportRow }) {
  const status = row.status
  const label =
    {
      add: "+ add",
      replace: "↻ replace",
      unchanged: "= unchanged",
      skip: "– skip",
      invalid: "✕ invalid",
      conflict: "✕ conflict"
    }[status] ?? status
  return (
    <Badge
      variant={
        status === "add"
          ? "success"
          : status === "replace"
            ? "info"
            : status === "invalid" || status === "conflict"
              ? "destructive"
              : "secondary"
      }
      className="h-auto min-h-5 whitespace-normal [overflow-wrap:anywhere]"
    >
      {label}
    </Badge>
  )
}
function Metadata({ row }: { row: ImportRow }) {
  const entries = Object.entries(row.case?.metadata ?? {})
  return entries.length ? (
    <div className="flex min-w-0 flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <Badge
          key={key}
          variant="secondary"
          className="h-auto min-h-5 max-w-full whitespace-normal [overflow-wrap:anywhere]"
        >
          {key}: {String(value)}
        </Badge>
      ))}
    </div>
  ) : (
    <span className="text-fg-muted">—</span>
  )
}
function PreviewRows({
  preview,
  page,
  onPageChange
}: {
  preview: ImportPreview
  page: number
  onPageChange: (page: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(preview.rows.length / ROWS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const rows = preview.rows.slice(safePage * ROWS_PER_PAGE, (safePage + 1) * ROWS_PER_PAGE)
  const hasReason = preview.rows.some((row) => row.reason)
  const issuesFor = (row: ImportRow) =>
    preview.issues.filter((issue) => issue.row_number === row.row_number)
  const issues = (row: ImportRow) => (
    <>
      {issuesFor(row).map((issue, index) => (
        <p
          key={index}
          className="mt-1 font-mono text-data-sm text-destructive [overflow-wrap:anywhere]"
        >
          {issue.field ? `${issue.field}: ` : ""}
          {issue.message}
        </p>
      ))}
    </>
  )
  return (
    <>
      {!rows.length ? (
        <EmptyState
          title="No rows to preview"
          description={preview.message ?? "The file has no data rows."}
        />
      ) : (
        <>
          <div className="hidden min-w-0 md:block">
            <Table className="min-w-[900px] table-fixed">
              <TableHeader>
                <TableRow>
                  {[
                    "Row",
                    "Plan",
                    "Input",
                    "Expected / marker",
                    "Type",
                    "Category",
                    "Metadata",
                    ...(hasReason ? ["Reason"] : [])
                  ].map((label) => (
                    <TableHead
                      key={label}
                      className={
                        label === "Row"
                          ? "w-16 text-right"
                          : label === "Input" || label === "Expected / marker"
                            ? "w-52"
                            : "w-32"
                      }
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.row_number}>
                    <TableCell className="text-right font-mono">
                      {formatInt(row.row_number)}
                    </TableCell>
                    <TableCell>
                      <PlanBadge row={row} />
                    </TableCell>
                    <TableCell className="whitespace-pre-wrap text-body [overflow-wrap:anywhere]">
                      {row.case?.input ?? "—"}
                      {issues(row)}
                    </TableCell>
                    <TableCell className="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">
                      {row.case?.expected_answer ?? "—"}
                    </TableCell>
                    <TableCell className="[overflow-wrap:anywhere]">
                      {row.case?.case_type ?? "—"}
                      {row.case?.security_test_type && (
                        <p className="mt-1 text-data-sm text-fg-muted">
                          {row.case.security_test_type.replaceAll("_", " ")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="font-mono [overflow-wrap:anywhere]">
                      {row.case?.category ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Metadata row={row} />
                    </TableCell>
                    {hasReason && (
                      <TableCell className="text-caption [overflow-wrap:anywhere]">
                        {row.reason ?? "—"}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y divide-line md:hidden">
            {rows.map((row) => (
              <article
                key={row.row_number}
                className="min-w-0 space-y-2 p-3 [overflow-wrap:anywhere]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-data text-fg-muted">
                    row {formatInt(row.row_number)}
                  </span>
                  <PlanBadge row={row} />
                </div>
                <p className="whitespace-pre-wrap text-body">{row.case?.input ?? "—"}</p>
                {issues(row)}
                <p className="whitespace-pre-wrap font-mono text-data-sm text-fg-muted">
                  {row.case?.case_type === "security" ? "marker" : "expected"}{" "}
                  <span className="text-fg">{row.case?.expected_answer ?? "—"}</span> ·{" "}
                  {row.case?.case_type ?? "—"} · {row.case?.category ?? "—"}
                  {row.case?.security_test_type &&
                    ` · ${row.case.security_test_type.replaceAll("_", " ")}`}
                </p>
                <Metadata row={row} />
                {row.reason && <p className="text-caption text-fg-muted">{row.reason}</p>}
              </article>
            ))}
          </div>
        </>
      )}
      {preview.rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-caption text-fg-muted">
          <span className="font-mono">
            Showing {formatInt(safePage * ROWS_PER_PAGE + 1)}–
            {formatInt(Math.min((safePage + 1) * ROWS_PER_PAGE, preview.rows.length))} of{" "}
            {formatInt(preview.rows.length)} {preview.rows.length === 1 ? "row" : "rows"}
          </span>
          {pageCount > 1 && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="relative max-md:h-11"
                disabled={safePage === 0}
                onClick={() => onPageChange(safePage - 1)}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="relative max-md:h-11"
                disabled={safePage === pageCount - 1}
                onClick={() => onPageChange(safePage + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
