import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ImportOptions, ImportPreview } from "@/api/dataset-import"
import type { DatasetSummary } from "@/api/datasets"
import { DatasetImportPage } from "@/pages/DatasetImportPage"

const PREVIEW = "/api/datasets/import/preview"
const COMMIT = "/api/datasets/import/commit"
const mapping = { input: "input", expected_answer: "answer" }
const datasets: DatasetSummary[] = ["one", "two"].map((id) => ({ id, name: `Dataset ${id}`, description: null, test_case_count: 7, created_at: "2026-01-01", updated_at: "2026-01-01" }))
function preview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return { source_columns: ["input", "answer", "type", "security", "category", "metadata"], suggestions: mapping, mapping,
    rows: [{ row_number: 2, status: "add", action: "add", existing_ids: [], case: { input: "Question", expected_answer: "Answer", case_type: "standard", security_test_type: null, category: null, metadata: null } }],
    issues: [], counts: { add: 1, replace: 0, unchanged: 0, skip: 0, invalid: 0, final: 1 }, fingerprint: "current-fingerprint", can_commit: true, ...overrides }
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function Location() { const location = useLocation(); return <span aria-label="Current location">{location.pathname}{location.search}</span> }
function mount(path = "/datasets/import") {
  return render(<MemoryRouter initialEntries={[path]}><Location /><Link to="/datasets/import?dataset=two">Select query two</Link><Link to="/datasets/import">Clear query</Link><Link to="/away">Leave import</Link><Routes><Route path="/datasets/import" element={<DatasetImportPage />} /><Route path="*" element={<p>Destination route</p>} /></Routes></MemoryRouter>)
}
const file = (name = "sample.csv", content = "input,answer\nQuestion,Answer") => new File([content], name, { type: "text/csv" })
const chooser = () => screen.getByLabelText("Choose a CSV or JSON file")
const importButton = () => screen.getByRole("button", { name: /^(Import .*rows|Updating preview…|Importing…)$/ })
async function tick(ms = 300) { await act(async () => { vi.advanceTimersByTime(ms) }) }
async function flush() { await act(async () => { await Promise.resolve() }) }
function choose(value = file()) { fireEvent.change(chooser(), { target: { files: [value] } }); return value }
function change(label: string | RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }

describe("dataset import flows", () => {
  const fetchMock = vi.fn<typeof fetch>()
  let previewHandler: (form: FormData) => Response | Promise<Response>
  let commitHandler: (form: FormData) => Response | Promise<Response>
  let listHandler: () => Response | Promise<Response>
  const forms = (endpoint: string) => fetchMock.mock.calls.filter(([url]) => String(url) === endpoint).map(([, init]) => init?.body as FormData)
  const options = (form: FormData) => JSON.parse(String(form.get("options"))) as ImportOptions
  async function ready() { await tick(); await tick(); expect(importButton()).toBeEnabled() }
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    previewHandler = () => response(preview())
    commitHandler = () => response({ dataset_id: "imported", counts: { add: 1 } })
    listHandler = () => response(datasets)
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === "/api/datasets") return listHandler()
      expect(init?.method).toBe("POST")
      if (String(url) === PREVIEW) return previewHandler(init?.body as FormData)
      if (String(url) === COMMIT) return commitHandler(init?.body as FormData)
      throw new Error(`Unexpected endpoint: ${String(url)}`)
    })
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it("labels the chooser and disables mapping and rules until a file is selected", async () => {
    mount(); await flush()
    expect(chooser()).toHaveAttribute("type", "file")
    expect(chooser()).toHaveAttribute("tabindex", "-1")
    expect(screen.getByRole("group", { name: "2 Column mapping" })).toBeDisabled()
    expect(screen.getByRole("group", { name: "3 Rules" })).toBeDisabled()
    expect(screen.getByLabelText(/Input · required/)).toBeDisabled()
    expect(screen.getByRole("radio", { name: "Block import" })).toBeDisabled()
    expect(importButton()).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Preview import" })).not.toBeInTheDocument()
    await tick(1000); expect(forms(PREVIEW)).toHaveLength(0); expect(forms(COMMIT)).toHaveLength(0)
  })

  it("debounces automatic preview and commits the exact latest file, options and fingerprint once", async () => {
    mount(); const selected = choose(); await tick(299); expect(forms(PREVIEW)).toHaveLength(0)
    await tick(1); expect(forms(PREVIEW)).toHaveLength(1); await tick(); expect(importButton()).toBeEnabled()
    change("Dataset name", "New name"); expect(importButton()).toBeDisabled()
    change("Dataset name", "Latest name"); await tick(299); expect(forms(PREVIEW)).toHaveLength(2)
    await tick(1); expect(forms(PREVIEW)).toHaveLength(3)
    fireEvent.click(importButton()); fireEvent.click(importButton()); await flush()
    expect(forms(COMMIT)).toHaveLength(1)
    const form = forms(COMMIT)[0]
    expect(form.get("file")).toBe(selected)
    expect(options(form)).toEqual({ destination: { mode: "new", name: "Latest name", description: null }, mapping, invalid_policy: "strict", duplicate_action: "skip" })
    expect(form.get("fingerprint")).toBe("current-fingerprint")
    expect(String(form.get("import_id"))).toMatch(/\S+/)
    expect(Array.from(form.keys())).toEqual(["file", "options", "fingerprint", "import_id"])
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/datasets/imported")
  })

  it.each(["success", "error"])("ignores an out of order old preview %s", async (outcome) => {
    const old = deferred<Response>(); const current = deferred<Response>()
    previewHandler = () => forms(PREVIEW).length === 1 ? old.promise : current.promise
    mount(); choose(file("old.csv")); await tick(); choose(file("new.csv")); await tick()
    if (outcome === "success") old.resolve(response(preview({ mapping: {}, counts: { add: 999, final: 999 } })))
    else old.reject(new Error("Old preview error"))
    await flush(); expect(importButton()).toBeDisabled(); expect(screen.queryByText("999")).not.toBeInTheDocument(); expect(screen.queryByText("Old preview error")).not.toBeInTheDocument()
    current.resolve(response(preview({ mapping: {} }))); await flush(); expect(importButton()).toHaveAccessibleName("Import 1 rows"); expect(importButton()).toBeEnabled()
  })

  it("retains the current draft on preview failure and retries it without a stale commit", async () => {
    mount(); choose(); await ready()
    previewHandler = () => response({ detail: "Cannot parse this draft" }, 422)
    change("Dataset name", "Retained"); await tick()
    expect(screen.getByRole("alert")).toHaveTextContent("Cannot parse this draft")
    expect(importButton()).toBeDisabled(); expect(screen.queryByRole("table")).not.toBeInTheDocument()
    previewHandler = () => response(preview())
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await tick()
    expect(screen.getByLabelText("Dataset name")).toHaveValue("Retained")
    expect(options(forms(PREVIEW).at(-1)!)).toMatchObject({ destination: { name: "Retained" } })
    expect(importButton()).toBeEnabled()
  })

  it("converges resolved mapping and dataset suggestions through a fresh preview", async () => {
    previewHandler = () => response(preview({ suggestions: { input: "answer" }, dataset_suggestion: { name: "Suggested title", description: "Suggested description" } }))
    mount(); choose(file("bundle.json")); await tick()
    expect(importButton()).toBeDisabled(); expect(screen.getByLabelText("Dataset name")).toHaveValue("Suggested title")
    expect(screen.getByLabelText(/Description/)).toHaveValue("Suggested description")
    await tick(); expect(forms(PREVIEW)).toHaveLength(2)
    expect(options(forms(PREVIEW)[1])).toEqual({ destination: { mode: "new", name: "Suggested title", description: "Suggested description" }, mapping, invalid_policy: "strict", duplicate_action: "skip" })
    expect(importButton()).toBeEnabled()
  })

  it("never overwrites a user name or description with file suggestions", async () => {
    previewHandler = () => response(preview({ dataset_suggestion: { name: "Suggested", description: "Suggested description" } }))
    mount(); change("Dataset name", "My name"); change(/Description/, "My description"); choose(); await ready()
    choose(file("different.json")); await ready()
    expect(screen.getByLabelText("Dataset name")).toHaveValue("My name"); expect(screen.getByLabelText(/Description/)).toHaveValue("My description")
  })

  it("preserves New drafts and Existing choices across toggles and follows query changes", async () => {
    mount("/datasets/import?dataset=one"); await flush()
    expect(screen.getByRole("radio", { name: "Add to existing" })).toBeChecked(); expect(screen.getByLabelText("Dataset")).toHaveValue("one")
    change("Dataset", "two"); fireEvent.click(screen.getByRole("radio", { name: "New dataset" })); change("Dataset name", "Draft"); change(/Description/, "Description")
    fireEvent.click(screen.getByRole("radio", { name: "Add to existing" })); expect(screen.getByLabelText("Dataset")).toHaveValue("two")
    fireEvent.click(screen.getByRole("radio", { name: "New dataset" })); expect(screen.getByLabelText("Dataset name")).toHaveValue("Draft"); expect(screen.getByLabelText(/Description/)).toHaveValue("Description")
    fireEvent.click(screen.getByRole("link", { name: "Select query two" })); expect(screen.getByLabelText("Dataset")).toHaveValue("two")
    fireEvent.click(screen.getByRole("link", { name: "Clear query" })); expect(screen.getByLabelText("Dataset name")).toHaveValue("Draft")
  })

  it.each(["success", "error"])("ignores pending commit %s after a dataset query change", async (outcome) => {
    const pending = deferred<Response>(); commitHandler = () => pending.promise
    mount("/datasets/import?dataset=one"); choose(); await ready(); fireEvent.click(importButton())
    expect(screen.getByLabelText("Dataset")).toBeDisabled()
    fireEvent.click(screen.getByRole("link", { name: "Select query two" }))
    if (outcome === "success") pending.resolve(response({ dataset_id: "old-result" }))
    else pending.reject(new Error("Old commit failed"))
    await flush(); expect(screen.getByLabelText("Current location")).toHaveTextContent("/datasets/import?dataset=two")
    expect(screen.queryByText("Old commit failed")).not.toBeInTheDocument(); expect(importButton()).toBeDisabled()
    await tick(); expect(options(forms(PREVIEW).at(-1)!)).toMatchObject({ destination: { dataset_id: "two" } })
  })

  it.each(["preview", "commit"])("guards pending %s completion after leaving the page", async (phase) => {
    const pending = deferred<Response>()
    mount(); choose()
    if (phase === "preview") { previewHandler = () => pending.promise; await tick() }
    else { await ready(); commitHandler = () => pending.promise; fireEvent.click(importButton()) }
    fireEvent.click(screen.getByRole("link", { name: "Leave import" }))
    pending.resolve(response(phase === "preview" ? preview() : { dataset_id: "unexpected" })); await flush(); await tick(1000)
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/away"); expect(forms(COMMIT)).toHaveLength(phase === "commit" ? 1 : 0)
  })

  it("blocks a missing selected dataset even when preview permits committing", async () => {
    mount("/datasets/import?dataset=missing"); choose(); await tick(); await tick()
    expect(screen.getByText("The selected dataset is not available. Choose another dataset.")).toBeInTheDocument(); expect(importButton()).toBeDisabled()
    change("Dataset", "one"); await tick(); expect(importButton()).toBeEnabled()
  })

  it("reports dataset list failure honestly and allows retry without losing the file", async () => {
    listHandler = () => response({}, 503); mount("/datasets/import?dataset=one"); choose(); await tick(); await tick()
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load datasets."); expect(screen.getByLabelText("Dataset")).toBeDisabled(); expect(importButton()).toBeDisabled()
    expect(screen.queryByText("The selected dataset is not available. Choose another dataset.")).not.toBeInTheDocument()
    listHandler = () => response(datasets); fireEvent.click(screen.getByRole("button", { name: "Retry" })); await flush()
    expect(screen.getByLabelText("Dataset")).toHaveValue("one"); expect(screen.getByText("sample.csv")).toBeInTheDocument(); expect(importButton()).toBeEnabled()
  })

  it("submits all six mappings, a literal tab delimiter and every policy value", async () => {
    mount(); choose(); await ready()
    const fields = [/Input · required/, /Expected answer · required/, /Case type/, /Security test type/, /Category/, /Metadata/]
    const values = ["answer", "input", "type", "security", "category", "metadata"]
    fields.forEach((label, index) => change(label, values[index]))
    change("Delimiter", "\t"); fireEvent.click(screen.getByRole("radio", { name: "Import valid rows only" })); fireEvent.click(screen.getByRole("radio", { name: "Replace" })); await tick()
    expect(options(forms(PREVIEW).at(-1)!)).toEqual({ destination: { mode: "new", name: "sample", description: null }, mapping: { input: "answer", expected_answer: "input", case_type: "type", security_test_type: "security", category: "category", metadata: "metadata" }, delimiter: "\t", invalid_policy: "valid_only", duplicate_action: "replace" })
    fireEvent.click(screen.getByRole("radio", { name: "Keep" })); fireEvent.click(screen.getByRole("radio", { name: "Block import" })); change(/Metadata/, ""); await tick()
    expect(options(forms(PREVIEW).at(-1)!)).toMatchObject({ mapping: { metadata: null }, duplicate_action: "keep", invalid_policy: "strict" })
    fireEvent.click(screen.getByRole("radio", { name: "Skip" })); await tick(); expect(options(forms(PREVIEW).at(-1)!)).toMatchObject({ duplicate_action: "skip" })
  })

  it.each(["Invalid rows must be fixed", "Duplicate conflict", "Dataset capacity exceeded", "Missing fingerprint"])("blocks import for %s", async (message) => {
    previewHandler = () => response(preview({ message, can_commit: message === "Missing fingerprint", fingerprint: message === "Missing fingerprint" ? undefined : "blocked", counts: { add: 0, invalid: 1, final: 7 } }))
    mount(); choose(); await tick(); await tick(); expect(importButton()).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent(message)
    fireEvent.click(importButton()); expect(forms(COMMIT)).toHaveLength(0)
  })

  it("permits an unchanged-only import with zero rows to write", async () => {
    previewHandler = () => response(preview({ counts: { add: 0, replace: 0, unchanged: 1, skip: 0, invalid: 0, final: 7 }, rows: [{ row_number: 2, status: "unchanged", action: null, existing_ids: ["case"] }] }))
    mount("/datasets/import?dataset=one"); choose(); await ready(); expect(importButton()).toHaveAccessibleName("Import 0 rows")
    fireEvent.click(importButton()); await flush(); expect(forms(COMMIT)).toHaveLength(1)
  })

  it("locks settings during commit and retains drafts with a stable retry ID until exact inputs change", async () => {
    const pending = deferred<Response>(); commitHandler = () => pending.promise
    mount(); choose(); await ready(); fireEvent.click(importButton()); fireEvent.click(importButton())
    expect(forms(COMMIT)).toHaveLength(1); expect(screen.getByLabelText("Dataset name")).toBeDisabled(); expect(chooser()).toBeDisabled(); expect(screen.getByLabelText("Delimiter")).toBeDisabled(); expect(screen.getByRole("radio", { name: "Keep" })).toBeDisabled()
    pending.reject(new Error("Network disconnected")); await flush(); expect(screen.getByRole("alert")).toHaveTextContent("Network disconnected"); expect(screen.getByLabelText("Dataset name")).toHaveValue("sample")
    commitHandler = () => response({ detail: "Retry failed" }, 503); fireEvent.click(importButton()); await flush()
    expect(forms(COMMIT)[1].get("import_id")).toBe(forms(COMMIT)[0].get("import_id"))
    expect(String(forms(COMMIT)[0].get("import_id"))).toMatch(/\S+/)
    change("Dataset name", "Changed input"); await tick(); fireEvent.click(importButton()); await flush()
    expect(forms(COMMIT)[2].get("import_id")).not.toBe(forms(COMMIT)[0].get("import_id"))
    expect(options(forms(COMMIT)[2])).toMatchObject({ destination: { name: "Changed input" } })
  })

  it("accepts drop, rejects invalid extensions and invalidates different files with the same name", async () => {
    mount(); const selected = file(); const zone = screen.getByText("Drop a CSV or JSON file here, or choose one").parentElement!.parentElement!
    fireEvent.drop(zone, { dataTransfer: { files: [selected] } }); await ready(); expect(forms(PREVIEW)[0].get("file")).toBe(selected)
    const replacement = file("sample.csv", "different content"); choose(replacement); expect(importButton()).toBeDisabled(); expect(screen.queryByRole("table")).not.toBeInTheDocument(); await ready()
    expect(forms(PREVIEW).at(-1)!.get("file")).toBe(replacement)
    const before = forms(PREVIEW).length; choose(file("unsupported.txt")); await tick(1000)
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a CSV or JSON file."); expect(forms(PREVIEW)).toHaveLength(before); expect(importButton()).toBeDisabled()
  })

  it.each(["destination changed", "lost network response"])("refreshes after %s with exact inputs and the appropriate retry ID", async (failure) => {
    const conflict = failure === "destination changed"
    const message = conflict ? "The destination changed. Preview the import again." : "Network disconnected"
    commitHandler = () => conflict ? response({ detail: message }, 409) : Promise.reject(new Error(message))
    mount("/datasets/import?dataset=one"); const selected = choose(); await ready()
    change("Delimiter", "\t"); fireEvent.click(screen.getByRole("radio", { name: "Import valid rows only" })); fireEvent.click(screen.getByRole("radio", { name: "Replace" })); await tick()
    const expected: ImportOptions = { destination: { mode: "existing", dataset_id: "one" }, mapping, delimiter: "\t", invalid_policy: "valid_only", duplicate_action: "replace" }
    expect(importButton()).toHaveAccessibleName("Import 1 rows")
    fireEvent.click(importButton()); await flush()
    expect(screen.getByRole("alert")).toHaveTextContent(message)
    const first = forms(COMMIT)[0]
    expect(Array.from(first.keys())).toEqual(["file", "options", "fingerprint", "import_id"])
    expect(first.get("file")).toBe(selected); expect(options(first)).toEqual(expected)
    expect(first.get("fingerprint")).toBe("current-fingerprint"); expect(String(first.get("import_id"))).toMatch(/\S+/)

    const fresh = deferred<Response>(); previewHandler = () => fresh.promise
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }))
    expect(importButton()).toBeDisabled(); expect(importButton()).toHaveAccessibleName("Updating preview…")
    expect(screen.queryByRole("table")).not.toBeInTheDocument(); expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByText("● updating")).toBeInTheDocument()
    const plan = screen.getByText("Import plan").closest("div")!.parentElement!
    expect(within(plan).getByRole("status")).toHaveTextContent("The import plan is updating. Wait for the current preview.")
    expect(within(plan).getByText("+ Add").parentElement).toHaveTextContent("—")
    expect(screen.getByLabelText("Dataset")).toHaveValue("one"); expect(screen.getByLabelText("Delimiter")).toHaveValue("\t")
    expect(screen.getByRole("radio", { name: "Import valid rows only" })).toBeChecked(); expect(screen.getByRole("radio", { name: "Replace" })).toBeChecked()
    expect(screen.getByText("sample.csv")).toBeInTheDocument()
    await tick()
    const refreshed = forms(PREVIEW).at(-1)!
    expect(Array.from(refreshed.keys())).toEqual(["file", "options"])
    expect(refreshed.get("file")).toBe(selected); expect(options(refreshed)).toEqual(expected)
    const fingerprint = conflict ? "new-destination-fingerprint" : "current-fingerprint"
    fresh.resolve(response(preview({ fingerprint, counts: { add: 2, replace: 1, unchanged: 0, skip: 0, invalid: 0, final: 10 } }))); await flush()
    expect(importButton()).toBeEnabled(); expect(importButton()).toHaveAccessibleName("Import 3 rows"); expect(screen.getByText("✓ ready")).toBeInTheDocument()
    expect(within(plan).getByText("+ Add").parentElement).toHaveTextContent("2")
    commitHandler = () => response({ dataset_id: "refreshed-result", counts: { add: 2, replace: 1 } })
    fireEvent.click(importButton()); await flush()
    expect(forms(COMMIT)).toHaveLength(2)
    const second = forms(COMMIT)[1]
    expect(Array.from(second.keys())).toEqual(["file", "options", "fingerprint", "import_id"])
    expect(second.get("file")).toBe(selected); expect(options(second)).toEqual(expected); expect(second.get("fingerprint")).toBe(fingerprint)
    expect(String(second.get("import_id"))).toMatch(/\S+/)
    if (conflict) expect(second.get("import_id")).not.toBe(first.get("import_id"))
    else expect(second.get("import_id")).toBe(first.get("import_id"))
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/datasets/refreshed-result")
  })

  it("paginates 25 rows using API row numbers and renders plan counts, reasons and issues", async () => {
    const statuses = ["add", "replace", "unchanged", "skip", "invalid", "conflict"]
    previewHandler = () => response(preview({ rows: Array.from({ length: 26 }, (_, index) => ({ ...preview().rows[0], row_number: index + 101, status: statuses[index % statuses.length], reason: `Reason ${index}`, case: { ...preview().rows[0].case!, input: `Input ${index}` } })), issues: [{ row_number: 101, field: "input", code: "bad", message: "Row issue" }, { row_number: 999, field: null, code: "file", message: "File issue" }], counts: { add: 9, replace: 3, unchanged: 4, skip: 5, invalid: 6, final: 1234 } }))
    mount(); choose(); await ready(); const table = within(screen.getByRole("table"))
    expect(table.getAllByRole("row")).toHaveLength(26); expect(table.getByText("101")).toBeInTheDocument(); expect(table.queryByText("126")).not.toBeInTheDocument()
    for (const label of ["+ add", "↻ replace", "= unchanged", "– skip", "✕ invalid", "✕ conflict"]) expect(table.getAllByText(label).length).toBeGreaterThan(0)
    expect(table.getByText("input: Row issue")).toBeInTheDocument(); expect(table.getByText("Reason 0")).toBeInTheDocument(); expect(screen.getByRole("alert")).toHaveTextContent("File issue")
    expect(screen.getByText("Showing 1–25 of 26 rows")).toBeInTheDocument(); expect(importButton()).toHaveAccessibleName("Import 12 rows")
    const plan = screen.getByText("Import plan").closest("div")!.parentElement!
    for (const [label, count] of [["+ Add", "9"], ["↻ Replace", "3"], ["= Unchanged", "4"], ["– Skip", "5"], ["✕ Invalid", "6"]]) expect(within(plan).getByText(label).parentElement).toHaveTextContent(count)
    expect(within(plan).getByText("1,234")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Next" })); expect(screen.getByText("Showing 26–26 of 26 rows")).toBeInTheDocument(); expect(within(screen.getByRole("table")).getByText("126")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Previous" })); expect(screen.getByText("Showing 1–25 of 26 rows")).toBeInTheDocument()
  })

  it("focuses the first mapping field, traps Tab and restores Edit after Escape", async () => {
    mount(); choose(); await ready(); const edit = screen.getByRole("button", { name: "Edit" }); edit.focus(); fireEvent.click(edit)
    expect(edit).toHaveAttribute("aria-expanded", "true"); const dialog = screen.getByRole("dialog", { name: "Column mapping" }); const fields = within(dialog)
    expect(edit).toHaveAttribute("aria-haspopup", "dialog")
    const controlledId = edit.getAttribute("aria-controls")
    expect(controlledId).toBeTruthy()
    expect(document.getElementById(controlledId!)).not.toBeNull()
    expect(dialog).toContainElement(document.getElementById(controlledId!))
    expect(fields.getByLabelText(/Input · required/)).toHaveFocus()
    fields.getByRole("button", { name: "Done" }).focus(); fireEvent.keyDown(document, { key: "Tab" }); expect(fields.getByRole("button", { name: "Close" })).toHaveFocus()
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(fields.getByRole("button", { name: "Done" })).toHaveFocus()
    fireEvent.change(fields.getByLabelText(/Input · required/), { target: { value: "answer" } }); expect(importButton()).toBeDisabled(); await tick(); expect(options(forms(PREVIEW).at(-1)!)).toMatchObject({ mapping: { input: "answer" } })
    fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(edit).toHaveFocus(); expect(edit).toHaveAttribute("aria-expanded", "false")
  })

  it("labels a security row's actual expected answer as a marker in the mobile preview", async () => {
    const marker = "CUSTOM_FORBIDDEN_MARKER"
    previewHandler = () => response(preview({ rows: [{ ...preview().rows[0], case: { ...preview().rows[0].case!, expected_answer: marker, case_type: "security", security_test_type: "instruction_override", category: "security-category" } }] }))
    mount(); choose(); await ready()
    expect(within(screen.getByRole("table")).getByText(marker)).toBeInTheDocument()
    const card = within(screen.getByRole("article"))
    expect(card.getByText(marker).parentElement).toHaveTextContent("marker CUSTOM_FORBIDDEN_MARKER · security · security-category · instruction override")
    expect(card.getByText(marker).parentElement).not.toHaveTextContent("expected")
    expect(card.queryByText("SECURITY_TEST_FAILED")).not.toBeInTheDocument()
  })

  it("renders long untrusted values as text in desktop and mobile previews", async () => {
    const unsafe = '<img src=x onerror="alert(1)"><script>alert(2)</script>' + "a".repeat(500)
    previewHandler = () => response(preview({ source_columns: [...preview().source_columns, unsafe], rows: [{ ...preview().rows[0], reason: unsafe, case: { ...preview().rows[0].case!, input: unsafe, expected_answer: unsafe, category: unsafe, metadata: { untrusted: unsafe } } }], issues: [{ row_number: 2, field: null, code: "unsafe", message: unsafe }] }))
    const view = mount(); choose(); await ready(); expect(within(screen.getByRole("table")).getAllByText(unsafe).length).toBeGreaterThan(0)
    expect(within(screen.getByRole("article")).getAllByText(unsafe).length).toBeGreaterThan(0)
    expect(view.container.querySelector("img, script")).toBeNull()
  })
})

