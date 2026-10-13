import { Download, FileUp, Pencil, Plus, Trash2 } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, useParams } from "react-router-dom"
import {
  createTestCase,
  deleteTestCase,
  getDataset,
  updateDataset,
  updateTestCase,
  type DatasetDetail,
  type TestCasePayload
} from "@/api/datasets"
import { TestCaseForm } from "@/components/TestCaseForm"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { InlineConfirm } from "@/components/ui/inline-confirm"
import { Input } from "@/components/ui/input"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { Textarea } from "@/components/ui/textarea"
import { download } from "@/lib/download"
import { formatDateTime, formatInt } from "@/lib/format"


export function DatasetDetailPage() {
  const { datasetId } = useParams()
  const epoch = useRef(0)
  const pending = useRef(false)
  const exportPending = useRef(false)
  const exportTrigger = useRef<HTMLButtonElement>(null)
  const exportMenu = useRef<HTMLDivElement>(null)
  const addTrigger = useRef<HTMLButtonElement>(null)
  const editTriggers = useRef(new Map<string, HTMLButtonElement>())
  const editorTriggerId = useRef<string | null>(null)
  const restoreEditorFocus = useRef(false)
  const confirmReturnFocus = useRef<HTMLElement | null>(null)
  const [dataset, setDataset] = useState<DatasetDetail | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [caseError, setCaseError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [editor, setEditor] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [switchTarget, setSwitchTarget] = useState<{ id: string | null } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [reload, setReload] = useState(0)
  const metadataChanged = Boolean(dataset && name.trim() && (
    name.trim() !== dataset.name || (description.trim() || null) !== dataset.description
  ))
  useEffect(() => {
    if (busy || editor !== null || !restoreEditorFocus.current) return
    restoreEditorFocus.current = false
    const trigger = editorTriggerId.current === "new"
      ? addTrigger.current
      : editTriggers.current.get(editorTriggerId.current ?? "")
    trigger?.focus()
  }, [busy, editor])
  useEffect(() => {
    if (exportOpen) exportMenu.current?.querySelector<HTMLButtonElement>("button")?.focus()
  }, [exportOpen])
  useEffect(() => {
    const ticket = ++epoch.current
    pending.current = false
    exportPending.current = false
    setExportBusy(false)
    setExportOpen(false)
    setDataset(null)
    setIsLoading(true)
    setPageError(null)
    setBusy(false)
    setEditor(null)
    setDirty(false)
    setSwitchTarget(null)
    setDeleteId(null)
    setDeleteError(null)
    restoreEditorFocus.current = false
    editorTriggerId.current = null
    setCaseError(null)
    setMetadataError(null)
    setExportError(null)
    setStatusMessage("")
    setSearch("")
    if (!datasetId) {
      setPageError("Dataset not found.")
      setIsLoading(false)
      return
    }
    getDataset(datasetId).then((result) => {
      if (epoch.current !== ticket) return
      setDataset(result)
      setName(result.name)
      setDescription(result.description ?? "")
    }).catch((error: unknown) => {
      if (epoch.current === ticket) setPageError(error instanceof Error ? error.message : "Could not load dataset.")
    }).finally(() => { if (epoch.current === ticket) setIsLoading(false) })
    return () => { ++epoch.current }
  }, [datasetId, reload])
  function openEditor(id: string | null) {
    if (pending.current || id === editor) return
    if (dirty) {
      confirmReturnFocus.current = document.activeElement instanceof HTMLElement
        ? document.activeElement : null
      setSwitchTarget({ id })
      return
    }
    changeEditor(id)
  }
  function changeEditor(id: string | null) {
    if (id === null) restoreEditorFocus.current = true
    else editorTriggerId.current = id
    setEditor(id)
    setDirty(false)
    setCaseError(null)
    setDeleteId(null)
    setDeleteError(null)
  }
  async function mutate(action: () => Promise<void>, onError: (message: string) => void) {
    if (pending.current) return
    const ticket = epoch.current
    pending.current = true
    setBusy(true)
    setStatusMessage("")
    try { await action() } catch (error) {
      if (epoch.current === ticket) onError(error instanceof Error ? error.message : "Could not update dataset.")
    } finally {
      if (epoch.current === ticket) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!datasetId || !dataset || !metadataChanged || pending.current) return
    const ticket = epoch.current
    setMetadataError(null)
    await mutate(async () => {
      const updated = await updateDataset(datasetId, { name: name.trim(), description: description.trim() || null })
      if (epoch.current !== ticket) return
      setDataset(updated)
      setName(updated.name)
      setDescription(updated.description ?? "")
      setStatusMessage("Dataset details saved.")
    }, setMetadataError)
  }
  async function saveCase(payload: TestCasePayload) {
    if (!datasetId || !dataset || !editor || pending.current || (editor === "new" && dataset.test_cases.length >= 500)) return
    const ticket = epoch.current
    const adding = editor === "new"
    const number = adding ? dataset.test_cases.length + 1 : dataset.test_cases.findIndex((item) => item.id === editor) + 1
    setCaseError(null)
    await mutate(async () => {
      const saved = adding ? await createTestCase(datasetId, payload) : await updateTestCase(datasetId, editor, payload)
      if (epoch.current !== ticket) return
      setDataset((current) => current ? { ...current, updated_at: saved.updated_at, test_cases: adding ? [...current.test_cases, saved] : current.test_cases.map((item) => item.id === saved.id ? saved : item) } : current)
      changeEditor(null)
      setStatusMessage(`✓ Case ${number} ${adding ? "added" : "saved"}.`)
    }, setCaseError)
  }
  async function removeCase() {
    if (!datasetId || !dataset || !deleteId || dataset.test_cases.length <= 1 || pending.current) return
    const ticket = epoch.current
    const number = dataset.test_cases.findIndex((item) => item.id === deleteId) + 1
    setDeleteError(null)
    await mutate(async () => {
      await deleteTestCase(datasetId, deleteId)
      if (epoch.current !== ticket) return
      setDataset((current) => current ? { ...current, test_cases: current.test_cases.filter((item) => item.id !== deleteId) } : current)
      setDeleteId(null)
      setStatusMessage(`✓ Case ${number} deleted.`)
    }, setDeleteError)
  }
  async function exportDataset(format: "json" | "csv") {
    if (!dataset || !datasetId || exportPending.current) return
    const ticket = epoch.current
    exportPending.current = true
    setExportBusy(true)
    setExportError(null)
    try { await download(`/api/datasets/${datasetId}/export?format=${format}`, `${dataset.name}.${format}`) }
    catch (error) { if (epoch.current === ticket) setExportError(error instanceof Error ? error.message : "Could not export dataset.") }
    finally {
      if (epoch.current === ticket) {
        exportPending.current = false
        setExportBusy(false)
      }
    }
  }
  const importPath = `/datasets/import?dataset=${datasetId}`
  const actions = dataset && <>
    <Link to={importPath} className={buttonVariants({ variant: "outline", size: "sm" })}>
      <FileUp aria-hidden="true" className="size-4" />Import cases
    </Link>
    <Button
      variant="outline"
      size="sm"
      disabled={exportBusy}
      onClick={() => void exportDataset("json")}
    >
      <Download aria-hidden="true" className="size-4" />Export JSON
    </Button>
    <Button variant="outline" size="sm" disabled={exportBusy} onClick={() => void exportDataset("csv")}>CSV</Button>
    <Link to="/evaluations/new" className={buttonVariants({ variant: "outline", size: "sm" })}>Evaluate</Link>
  </>
  const editingCase = dataset?.test_cases.find((item) => item.id === editor)
  const editorNumber = dataset?.test_cases.findIndex((item) => item.id === editor)
  function renderEditor() {
    return <div
      className="min-w-0 space-y-4 bg-selected p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault()
          openEditor(null)
        }
      }}
    >
      <h3 className="text-section">{editor === "new" ? "New case" : `Editing case ${(editorNumber ?? 0) + 1}`}
      </h3>
      <TestCaseForm
        key={editor}
        initial={editingCase}
        editor
        submitLabel={editor === "new" ? "Add case" : "Save case"}
        busy={busy || !!switchTarget}
        error={caseError}
        onSubmit={saveCase}
        onCancel={() => openEditor(null)}
        onDirtyChange={setDirty}
      />
      {switchTarget && <InlineConfirm
        returnFocusRef={confirmReturnFocus}
        message={`Discard changes to ${editor === "new" ? "new case" : `case ${(editorNumber ?? 0) + 1}`}?`}
        confirmLabel="Discard changes"
        onCancel={() => setSwitchTarget(null)}
        onConfirm={() => {
          changeEditor(switchTarget.id)
          setSwitchTarget(null)
        }}
      />}
    </div>
  }
  const security = dataset?.test_cases.filter((item) => item.case_type === "security").length ?? 0
  const visible = dataset?.test_cases.map((item, index) => ({ item, number: index + 1 })).filter(({ item }) => item.id === editor || `${item.input} ${item.expected_answer} ${JSON.stringify(item.metadata ?? {})}`.toLowerCase().includes(search.toLowerCase())) ?? []
  return <PageFrame
    breadcrumbs={[{ label: "Datasets", to: "/datasets" }, { label: dataset?.name ?? "Dataset" }]}
    actions={actions}
    mobileTitle="Datasets"
    mobileBack={{ label: "Datasets", to: "/datasets" }}
  >
    <PageHeader
      title={dataset?.name ?? "Dataset"}
      metadata={dataset && <>
        <span className="font-mono">{formatInt(dataset.test_cases.length)} {dataset.test_cases.length === 1 ? "case" : "cases"} · max 500
        </span>
        <span className="font-mono">
          <span className="text-warning">{security} security
          </span> · {dataset.test_cases.length - security} standard
        </span>
        <span className="font-mono">Updated {formatDateTime(dataset.updated_at)}
        </span>
      </>}
    />
    {isLoading ? <Card>
      <LoadingState label="Loading dataset…" />
    </Card> : pageError || !dataset ? <Card>
      <ErrorState
        message={pageError ?? "Dataset not found."}
        onRetry={() => setReload((value) => value + 1)}
      />
      <Link to="/datasets" className={buttonVariants({ variant: "outline" })}>Back to datasets</Link>
    </Card> : <>
      <div className="grid grid-cols-3 gap-2 md:hidden">
        <Link to={importPath} className={buttonVariants({ variant: "outline", size: "touch" })}>Import</Link>
        <div className="relative">
          <Button
            ref={exportTrigger}
            variant="outline"
            className="w-full max-md:min-h-11"
            aria-expanded={exportOpen}
            aria-controls="dataset-export-menu"
            onClick={() => setExportOpen((value) => !value)}
          >Export</Button>{exportOpen && <div
            ref={exportMenu}
            id="dataset-export-menu"
            role="menu"
            aria-label="Export dataset"
            className="absolute z-10 min-w-32 rounded-md border border-line bg-panel p-1"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                setExportOpen(false)
                exportTrigger.current?.focus()
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault()
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
                const position = items.indexOf(document.activeElement as HTMLButtonElement)
                const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (position + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
                items[next]?.focus()
              }
            }}
          >
            <Button
              role="menuitem"
              variant="ghost"
              className="min-h-11 w-full"
              disabled={exportBusy}
              onClick={() => {
                void exportDataset("json")
                setExportOpen(false)
                exportTrigger.current?.focus()
              }}
            >JSON</Button>
            <Button
              role="menuitem"
              variant="ghost"
              className="min-h-11 w-full"
              disabled={exportBusy}
              onClick={() => {
                void exportDataset("csv")
                setExportOpen(false)
                exportTrigger.current?.focus()
              }}
            >CSV</Button>
          </div>}
        </div>
        <Link to="/evaluations/new" className={buttonVariants({ variant: "outline", size: "touch" })}>Evaluate</Link>
      </div>
      {exportError && <Alert variant="destructive">{exportError}
      </Alert>}
      <div className="flex min-w-0 flex-col gap-5">
        <Card className="order-2 md:order-1">
          <CardHeader>
            <h2 className="text-section">Details</h2>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={saveDetails}
              className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_auto]"
              noValidate
            >
              <div className="space-y-1.5">
                <label htmlFor="detail-dataset-name" className="text-caption">Name</label>
                <Input
                  id="detail-dataset-name"
                  value={name}
                  maxLength={120}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="detail-dataset-description" className="text-caption">Description{" "}
                  <span className="text-fg-muted">Optional</span>
                </label>
                <Textarea
                  id="detail-dataset-description"
                  rows={1}
                  className="min-h-11 md:min-h-9"
                  value={description}
                  maxLength={500}
                  disabled={busy}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                className="max-md:min-h-11"
                disabled={busy || !metadataChanged}
              >Save details</Button>
              {metadataError && <Alert variant="destructive" className="md:col-span-3">{metadataError}
              </Alert>}
              {!name.trim() && <p className="text-caption text-destructive">Dataset name is required.</p>}
              {statusMessage === "Dataset details saved." && <Alert variant="success" role="status" className="md:col-span-3">{statusMessage}
              </Alert>}
            </form>
          </CardContent>
        </Card>
        <Card className="order-1 min-w-0 md:order-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-section">Test cases</h2>
                <p className="text-caption text-fg-muted">Stable IDs keep each case traceable in past runs.</p>
              </div>
              <Button
                ref={addTrigger}
                variant="outline"
                className="max-md:min-h-11"
                disabled={busy || dataset.test_cases.length >= 500}
                onClick={() => openEditor("new")}
              >
                <Plus aria-hidden="true" className="size-4" />Add case
              </Button>
            </div>
            <Field label="Search test cases" htmlFor="search-test-cases" className="w-full">
              <Input
                placeholder="Search input, marker, metadata…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            {dataset.test_cases.length >= 500 && <p className="text-caption text-fg-muted">This dataset has reached the limit of 500 test cases.</p>}
            {dataset.test_cases.length === 1 && <p className="text-caption text-fg-muted">A dataset needs at least one case.</p>}
            {statusMessage.startsWith("✓") && <Alert variant="success" role="status">{statusMessage}
            </Alert>}
          </CardHeader>
          {editor === "new" && renderEditor()}
          <div className="min-w-0 md:overflow-x-auto">
            <div className="md:min-w-[920px]">
              <div
                className="hidden grid-cols-[48px_200px_minmax(0,1fr)_200px_84px] gap-4 border-y border-line bg-chrome px-4 py-2 text-caption text-fg-muted md:grid"
              >
                <span>Case</span>
                <span>Type · category</span>
                <span>Input · metadata</span>
                <span>Expected / failure marker</span>
                <span>Actions</span>
              </div>
              {visible.map(({ item, number }) => <article
                key={item.id}
                aria-label={`Case ${number}`}
                className="min-w-0 border-b border-line last:border-0"
              >
                {editor === item.id ? renderEditor() : <div className="grid min-w-0 gap-3 p-4 md:grid-cols-[48px_200px_minmax(0,1fr)_200px_84px] md:gap-4">
                  <span className="font-mono text-data text-fg-muted" title={item.id}>#{number}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <Badge variant={item.case_type === "security" ? "warning" : "secondary"}>{item.case_type === "security" ? "⚠ security" : "standard"}
                    </Badge>{item.security_test_type && <p className="font-mono text-data-sm [overflow-wrap:anywhere]">{item.security_test_type.replaceAll("_", " ")}
                    </p>}{item.category && <p className="font-mono text-data-sm text-fg-muted [overflow-wrap:anywhere]">{item.category}
                    </p>}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <p className="line-clamp-5 whitespace-pre-line text-body [overflow-wrap:anywhere] md:line-clamp-4">{item.input}
                    </p>{item.metadata && <div className="flex min-w-0 flex-wrap gap-1">{Object.entries(item.metadata).map(([key, value]) => <Badge
                      key={key}
                      variant="secondary"
                      className="h-auto min-h-5 min-w-0 max-w-full whitespace-normal py-0.5 font-mono text-data-sm [overflow-wrap:anywhere]"
                    >
                      <span className="text-fg-muted">{key}:
                      </span>
                      <span>{String(value)}
                      </span>
                    </Badge>)}
                    </div>}
                  </div>
                  <p className="min-w-0 whitespace-pre-wrap font-mono text-data [overflow-wrap:anywhere]">
                    <span className="text-fg-muted md:hidden">{item.case_type === "security" ? "marker: " : "expected: "}
                    </span>
                    <span>{item.expected_answer}
                    </span>
                  </p>
                  <div className="flex gap-2">
                    <Button
                      ref={(element) => { if (element) editTriggers.current.set(item.id, element); else editTriggers.current.delete(item.id) }}
                      variant="ghost"
                      size="icon-lg"
                      className="relative max-md:flex-1 max-md:w-auto md:size-8"
                      disabled={busy}
                      aria-label={`Edit case ${number}`}
                      onClick={() => openEditor(item.id)}
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                      <span className="md:sr-only">Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      className="relative max-md:flex-1 max-md:w-auto md:size-8"
                      disabled={busy || dataset.test_cases.length === 1}
                      title={dataset.test_cases.length === 1 ? "A dataset needs at least one case." : undefined}
                      aria-label={`Delete case ${number}`}
                      onClick={() => {
                        if (pending.current) return
                        setDeleteId(item.id)
                        setDeleteError(null)
                      }}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      <span className="md:sr-only">Delete</span>
                    </Button>
                  </div>
                </div>}
                {deleteId === item.id && <div className="space-y-2 p-4">
                  <InlineConfirm
                    label={`Delete case ${number}`}
                    message={`Delete case ${number}? Past runs keep their snapshot of it.`}
                    confirmLabel="Delete case"
                    pending={busy}
                    onCancel={() => {
                      if (!busy) {
                        setDeleteId(null)
                        setDeleteError(null)
                      }
                    }}
                    onConfirm={() => void removeCase()}
                  />{deleteError && <Alert variant="destructive">{deleteError}
                  </Alert>}
                </div>}
              </article>)}
              {!visible.length && <EmptyState title="No cases match this search" />}
            </div>
          </div>
        </Card>
      </div>
    </>}
  </PageFrame>
}
