import { AlertCircle, FileUp, LoaderCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"

import { commitDatasetImport, getDatasetsForImport, previewDatasetImport, type ImportOptions, type ImportPreview } from "@/api/dataset-import"
import type { DatasetSummary } from "@/api/datasets"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

const targets = ["input", "expected_answer", "case_type", "security_test_type", "category", "metadata"]

export function DatasetImportPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<"new" | "existing">(params.get("dataset") ? "existing" : "new")
  const [datasetId, setDatasetId] = useState(params.get("dataset") ?? "")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [invalidPolicy, setInvalidPolicy] = useState<"strict" | "valid_only">("strict")
  const [duplicateAction, setDuplicateAction] = useState<"skip" | "replace" | "keep">("skip")
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [previewPage, setPreviewPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void getDatasetsForImport().then(setDatasets).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load datasets.")) }, [])
  const options = (): ImportOptions => ({ destination: mode === "new" ? { mode, name, description: description || null } : { mode, dataset_id: datasetId }, mapping, invalid_policy: invalidPolicy, duplicate_action: duplicateAction })
  async function previewFile() {
    if (!file) { setError("Choose a CSV or JSON file."); return }
    setBusy(true); setError(null)
    try {
      const result = await previewDatasetImport(file, options())
      setPreview(result)
      setPreviewPage(0)
      if (Object.keys(mapping).length === 0) setMapping(result.mapping)
      if (mode === "new" && result.dataset_suggestion?.name && !name) { setName(result.dataset_suggestion.name); setDescription(result.dataset_suggestion.description ?? "") }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not preview the file.") } finally { setBusy(false) }
  }
  async function commit() {
    if (!file || !preview?.fingerprint) return
    setBusy(true); setError(null)
    try {
      const result = await commitDatasetImport(file, options(), preview.fingerprint, crypto.randomUUID())
      navigate(`/datasets/${result.dataset_id}`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not import the file.") } finally { setBusy(false) }
  }
  return <div className="mx-auto max-w-5xl space-y-6">
    <Link to="/datasets" className="text-sm text-muted-foreground hover:text-foreground">Back to datasets</Link>
    <header><h1 className="text-3xl font-semibold">Import dataset</h1><p className="mt-2 text-muted-foreground">Upload a CSV or JSON file, review validation and duplicates, then import the planned changes.</p></header>
    <section className="space-y-4 rounded-xl border bg-card p-5"><label className="block text-sm font-medium">File<Input className="mt-2" type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null) }} /></label>
      <div className="flex gap-5 text-sm"><label><input type="radio" checked={mode === "new"} onChange={() => { setMode("new"); setPreview(null) }} /> Create dataset</label><label><input type="radio" checked={mode === "existing"} onChange={() => { setMode("existing"); setPreview(null) }} /> Add to existing dataset</label></div>
      {mode === "new" ? <div className="grid gap-3 sm:grid-cols-2"><Input value={name} onChange={(event) => { setName(event.target.value); setPreview(null) }} placeholder="Dataset name" /><Textarea value={description} onChange={(event) => { setDescription(event.target.value); setPreview(null) }} placeholder="Description (optional)" /></div> : <Select value={datasetId} onChange={(event) => { setDatasetId(event.target.value); setPreview(null) }}><option value="">Select a dataset</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</Select>}
      <div className="flex flex-wrap gap-3"><label>Invalid rows <select value={invalidPolicy} onChange={(event) => { setInvalidPolicy(event.target.value as "strict" | "valid_only"); setPreview(null) }}><option value="strict">Block import</option><option value="valid_only">Import valid rows only</option></select></label><label>Duplicates <select value={duplicateAction} onChange={(event) => { setDuplicateAction(event.target.value as "skip" | "replace" | "keep"); setPreview(null) }}><option value="skip">Skip</option><option value="replace">Replace</option><option value="keep">Keep</option></select></label></div>
      <Button type="button" disabled={busy} onClick={() => void previewFile()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}Preview import</Button></section>
    {error && <Alert variant="destructive" role="alert"><AlertCircle className="mr-2 inline size-4" />{error}</Alert>}
    {preview && <section className="space-y-4 rounded-xl border bg-card p-5"><h2 className="text-xl font-semibold">Preview</h2>{preview.source_columns.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{targets.map((target) => <label key={target} className="text-sm">{target.replaceAll("_", " ")} {target === "input" || target === "expected_answer" ? "(required)" : "(optional)"}<Select className="mt-1 block h-9" value={mapping[target] ?? ""} onChange={(event) => { setMapping({ ...mapping, [target]: event.target.value || null }); setPreview(null) }}><option value="">Ignore</option>{preview.source_columns.map((column) => <option key={column} value={column}>{column}</option>)}</Select></label>)}</div>}
      {preview.counts && <p role="status">Add {preview.counts.add}, replace {preview.counts.replace}, unchanged {preview.counts.unchanged}, skip {preview.counts.skip}, invalid {preview.counts.invalid}; final size {preview.counts.final}.</p>}
      {preview.issues.length > 0 && <ul className="max-h-48 overflow-auto rounded border p-3 text-sm text-destructive-soft-foreground">{preview.issues.map((issue, index) => <li key={index}>Row {issue.row_number}: {issue.message}</li>)}</ul>}
      <PreviewRows preview={preview} page={previewPage} onPageChange={setPreviewPage} />
      {!preview.can_commit && <p className="text-sm text-muted-foreground">{preview.message}</p>}<Button type="button" disabled={busy || !preview.can_commit} onClick={() => void commit()}>Import planned rows</Button></section>}
  </div>
}

const ROWS_PER_PAGE = 25

function PreviewRows({ preview, page, onPageChange }: { preview: ImportPreview; page: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(preview.rows.length / ROWS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const rows = preview.rows.slice(safePage * ROWS_PER_PAGE, (safePage + 1) * ROWS_PER_PAGE)

  return <div className="space-y-3"><div className="overflow-x-auto rounded-lg border"><table className="min-w-full text-left text-sm"><thead className="bg-muted/50"><tr><th className="p-3">Row</th><th className="min-w-72 p-3">Input</th><th className="min-w-48 p-3">Expected answer / failure marker</th><th className="p-3">Type</th><th className="p-3">Category</th><th className="min-w-44 p-3">Metadata</th><th className="p-3">Status</th><th className="p-3">Action</th><th className="min-w-48 p-3">Reason</th></tr></thead><tbody>{rows.map((row) => <tr key={row.row_number} className="border-t align-top"><td className="p-3 font-medium">{row.row_number}</td><td className="max-w-96 whitespace-pre-wrap break-words p-3">{row.case?.input ?? "—"}</td><td className="max-w-64 whitespace-pre-wrap break-words p-3">{row.case?.expected_answer ?? "—"}</td><td className="p-3">{row.case ? <><div>{row.case.case_type}</div>{row.case.security_test_type && <div className="mt-1 text-xs text-muted-foreground">{row.case.security_test_type.replaceAll("_", " ")}</div>}</> : "—"}</td><td className="p-3">{row.case?.category ?? "—"}</td><td className="max-w-64 whitespace-pre-wrap break-words p-3 font-mono text-xs">{row.case?.metadata ? JSON.stringify(row.case.metadata) : "—"}</td><td className="p-3">{row.status}</td><td className="p-3">{row.action ?? "—"}</td><td className="p-3">{row.reason ?? "—"}</td></tr>)}</tbody></table></div>{preview.rows.length > ROWS_PER_PAGE && <div className="flex items-center justify-between text-sm"><span>Showing {safePage * ROWS_PER_PAGE + 1}–{Math.min((safePage + 1) * ROWS_PER_PAGE, preview.rows.length)} of {preview.rows.length} rows</span><div className="flex gap-2"><Button type="button" variant="outline" size="xs" disabled={safePage === 0} onClick={() => onPageChange(safePage - 1)}>Previous</Button><Button type="button" variant="outline" size="xs" disabled={safePage === pageCount - 1} onClick={() => onPageChange(safePage + 1)}>Next</Button></div></div>}</div>
}
