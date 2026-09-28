import type { DatasetSummary } from "@/api/datasets"

export type ImportOptions = {
  destination: { mode: "new"; name: string; description: string | null } | { mode: "existing"; dataset_id: string }
  mapping: Record<string, string | null>
  delimiter?: string
  invalid_policy: "strict" | "valid_only"
  duplicate_action: "skip" | "replace" | "keep"
}

export type ImportIssue = { row_number: number; field: string | null; code: string; message: string }
export type ImportCase = {
  input: string
  expected_answer: string
  case_type: string
  security_test_type: string | null
  category: string | null
  metadata: Record<string, string | number | boolean | null> | null
}

export type ImportRow = {
  row_number: number
  status: string
  action: string | null
  reason?: string
  existing_ids: string[]
  target_id?: string
  case?: ImportCase
}
export type ImportPreview = {
  source_columns: string[]
  suggestions: Record<string, string | null>
  mapping: Record<string, string | null>
  rows: ImportRow[]
  issues: ImportIssue[]
  counts?: Record<string, number>
  fingerprint?: string
  can_commit: boolean
  message?: string | null
  dataset_suggestion?: { name?: string; description?: string | null } | null
}

async function submit(path: string, file: File, options: ImportOptions, extra: Record<string, string> = {}) {
  const form = new FormData()
  form.append("file", file)
  form.append("options", JSON.stringify(options))
  Object.entries(extra).forEach(([key, value]) => form.append(key, value))
  const response = await fetch(path, { method: "POST", body: form })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(body.detail ?? "The import request could not be completed.")
  }
  return response.json()
}

export function previewDatasetImport(file: File, options: ImportOptions) {
  return submit("/api/datasets/import/preview", file, options) as Promise<ImportPreview>
}

export function commitDatasetImport(file: File, options: ImportOptions, fingerprint: string, importId: string) {
  return submit("/api/datasets/import/commit", file, options, { fingerprint, import_id: importId }) as Promise<{ dataset_id: string; counts: Record<string, number> }>
}

export async function getDatasetsForImport(): Promise<DatasetSummary[]> {
  const response = await fetch("/api/datasets")
  if (!response.ok) throw new Error("Could not load datasets.")
  return response.json() as Promise<DatasetSummary[]>
}
