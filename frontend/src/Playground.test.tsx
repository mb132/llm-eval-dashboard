import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Link, MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ModelConfiguration } from "@/api/models"
import type { PlaygroundResult } from "@/api/playground"
import { PlaygroundPage } from "@/pages/playground-page"

const RUN = "/api/playground/run"
const model: ModelConfiguration = {
  id: 1, display_name: "First model", model_name: "first-model", active: true,
  runnable: true, unavailable_reason: null, parameters: { temperature: 0.2 },
  provider: { id: 1, display_name: "Work provider", kind: "openai", base_url: null, has_api_key: true, api_key_requirement: "required" },
  pricing: { input_usd_per_million_tokens: "1.25", output_usd_per_million_tokens: "5", currency: "USD", source: "manual", effective_date: "2026-01-01", source_url: null },
  created_at: "2026-01-01T00:00:00Z",
}
const second: ModelConfiguration = { ...model, id: 2, display_name: "Second model", model_name: "second-model", pricing: null }
function reply(overrides: Partial<PlaygroundResult> = {}): PlaygroundResult {
  return { model_id: 1, display_name: model.display_name, provider: "openai", model_name: model.model_name,
    response: "Paris.", latency_ms: 3757.5, input_tokens: 1000, output_tokens: 200, total_tokens: 1200, finish_reason: "stop", ...overrides }
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
function mount() {
  return render(<MemoryRouter initialEntries={["/playground"]}>
    <Link to="/playground?draft=next">Change query</Link><Link to="/away">Leave playground</Link><Link to="/playground">Return to playground</Link>
    <Routes><Route path="/playground" element={<PlaygroundPage />} /><Route path="*" element={<p>Destination route</p>} /></Routes>
  </MemoryRouter>)
}
const prompt = () => screen.getByRole("textbox", { name: "Prompt" })
const system = () => screen.getByRole("textbox", { name: /System prompt/ })
const select = () => screen.getByRole("combobox", { name: "Model" })
const run = () => screen.getByRole("button", { name: "Run prompt" })
const panel = () => screen.getByRole("region", { name: "Reply" })
function change(control: HTMLElement, value: string) { fireEvent.change(control, { target: { value } }) }
async function flush() { await act(async () => { await Promise.resolve() }) }
function metric(label: string) { return within(within(panel()).getByText(label).parentElement!) }

describe("Playground behavior", () => {
  const fetchMock = vi.fn<typeof fetch>()
  let modelsHandler: () => Response | Promise<Response>
  let runHandler: () => Response | Promise<Response>
  const posts = () => fetchMock.mock.calls.filter(([url]) => String(url) === RUN)
  const bodies = () => posts().map(([, init]) => JSON.parse(String(init?.body)))
  async function ready() { await waitFor(() => expect(select()).toBeEnabled()) }
  async function submit() { await ready(); change(prompt(), "Question"); fireEvent.click(run()); await flush() }
  beforeEach(() => {
    fetchMock.mockReset()
    modelsHandler = () => response([model, second])
    runHandler = () => response(reply())
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === "/api/models") return modelsHandler()
      if (String(url) === RUN) return runHandler()
      throw new Error(`Unexpected endpoint: ${String(url)}`)
    })
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it("keeps loading distinct from empty, and exposes labelled fields and the unsaved reply state", async () => {
    const pending = deferred<Response>(); modelsHandler = () => pending.promise
    mount()
    expect(screen.getByRole("status")).toHaveTextContent("Loading models…")
    expect(select()).toBeDisabled(); expect(run()).toBeDisabled()
    expect(screen.queryByText("No runnable model. Add one in Models.")).not.toBeInTheDocument()
    expect(screen.getByText("Not saved · replies never appear in runs")).toBeInTheDocument()
    expect(panel()).toHaveAttribute("aria-live", "polite")
    expect(within(panel()).getByText("Run a prompt to see the reply here.")).toBeInTheDocument()
    expect(prompt()).toBeRequired(); expect(prompt()).toHaveAttribute("rows", "7"); expect(system()).toHaveAttribute("rows", "3")
    await act(async () => pending.resolve(response([model])))
    expect(select()).toHaveValue("1"); expect(run()).toBeDisabled()
    change(prompt(), " \n "); expect(run()).toBeDisabled()
    change(prompt(), "Question"); expect(run()).toBeEnabled()
  })

  it("omits inactive and custom models and respects server availability over credential inference", async () => {
    modelsHandler = () => response([
      { ...model, id: 3, display_name: "Inactive", active: false },
      { ...model, id: 4, display_name: "Custom", provider: { ...model.provider, kind: "custom" } },
      { ...model, id: 5, display_name: "Blocked", runnable: false, unavailable_reason: "Provider disabled" },
      { ...model, id: 6, display_name: "Fallback", runnable: false, unavailable_reason: null },
      { ...model, provider: { ...model.provider, has_api_key: false }, unavailable_reason: "Obsolete reason" },
    ])
    mount(); await ready()
    expect(screen.queryByRole("option", { name: /Inactive|Custom/ })).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Blocked.*Provider disabled/ })).toBeDisabled()
    expect(screen.getByRole("option", { name: /Fallback.*Model unavailable/ })).toBeDisabled()
    expect(screen.getByRole("option", { name: "First model · first-model" })).toBeEnabled()
    expect(select()).toHaveValue("1")
    expect(screen.getByText(/Custom endpoints are not listed/)).toBeInTheDocument()
  })

  it("shows Models navigation only for a genuinely empty runnable list", async () => {
    modelsHandler = () => response([{ ...model, runnable: false, unavailable_reason: "Credentials unavailable" }])
    mount(); await flush()
    expect(screen.getByText("No runnable model. Add one in Models.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Add model" })).toHaveAttribute("href", "/models")
    expect(screen.getByRole("option", { name: /Credentials unavailable/ })).toBeDisabled()
    change(prompt(), "Question"); expect(run()).toBeDisabled(); expect(posts()).toHaveLength(0)
  })

  it("shows a model-list failure honestly and retries loading without losing the draft", async () => {
    modelsHandler = () => response({ detail: "Model service unavailable" }, 503)
    mount(); await screen.findByRole("alert")
    expect(screen.getByRole("alert")).toHaveTextContent("Model service unavailable")
    expect(screen.queryByText("No runnable model. Add one in Models.")).not.toBeInTheDocument()
    change(prompt(), "Retained draft"); change(system(), "Retained system")
    expect(select()).toBeDisabled(); expect(run()).toBeDisabled()
    modelsHandler = () => response([second])
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await ready()
    expect(select()).toHaveValue("2"); expect(prompt()).toHaveValue("Retained draft"); expect(system()).toHaveValue("Retained system")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it.each(["  Be concise. \n", " \n "])("posts the exact prompt and normalized optional system %j once", async (value) => {
    mount(); await ready(); change(prompt(), " \nQuestion\n "); change(system(), value)
    fireEvent.click(run()); await flush()
    expect(posts()).toHaveLength(1)
    expect(posts()[0][1]).toEqual({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model_id: 1, prompt: " \nQuestion\n ", system_prompt: value.trim() || null }) })
    expect(within(panel()).getByText("Paris.")).toBeInTheDocument()
    expect(within(panel()).getByText("✓ complete")).toBeInTheDocument()
    expect(within(panel()).queryByRole("link")).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/api/models", RUN])
    expect(screen.getByText("One request. Nothing is stored.")).toBeInTheDocument()
  })

  it.each(["ctrlKey", "metaKey"])("runs %s+Enter only from Prompt, outside IME composition", async (modifier) => {
    mount(); await ready(); change(prompt(), "Question")
    for (const target of [system(), select(), document.body]) fireEvent.keyDown(target, { key: "Enter", [modifier]: true })
    fireEvent.keyDown(prompt(), { key: "Enter" }); fireEvent.keyDown(prompt(), { key: "Enter", [modifier]: true, isComposing: true })
    expect(posts()).toHaveLength(0)
    fireEvent.keyDown(prompt(), { key: "Enter", [modifier]: true }); await flush()
    expect(posts()).toHaveLength(1)
  })

  it("guards simultaneous shortcut and manual submits, and disables every request control while pending", async () => {
    const pending = deferred<Response>(); runHandler = () => pending.promise
    mount(); await ready(); change(prompt(), "Question")
    const form = prompt().closest("form")!
    act(() => { fireEvent.keyDown(prompt(), { key: "Enter", ctrlKey: true }); fireEvent.submit(form); fireEvent.submit(form) })
    expect(posts()).toHaveLength(1)
    for (const control of [prompt(), system(), select(), screen.getByRole("button", { name: "Running…" })]) expect(control).toBeDisabled()
    expect(panel()).toHaveAttribute("aria-busy", "true")
    expect(within(panel()).getByText("● running")).toBeInTheDocument()
    expect(within(panel()).getByRole("status")).toHaveTextContent("Waiting for First model…")
    await act(async () => pending.resolve(response(reply())))
    expect(run()).toBeEnabled(); expect(panel()).toHaveAttribute("aria-busy", "false")
  })

  it("preserves provider error text and draft, retries the captured request, and runs the edited draft separately", async () => {
    const message = 'Provider HTTP 429: <img src=x onerror="alert(1)"> quota exhausted'
    runHandler = () => response({ detail: message }, 502)
    mount(); await ready(); change(prompt(), " Original prompt "); change(system(), " Original system "); fireEvent.click(run()); await flush()
    expect(within(panel()).getByRole("alert")).toHaveTextContent(message)
    expect(within(panel()).getByRole("alert")).toHaveTextContent("Try again with the same request")
    expect(panel().querySelector("img, script")).toBeNull()
    expect(panel()).not.toHaveTextContent("HTTP 502")
    expect(prompt()).toHaveValue(" Original prompt "); expect(system()).toHaveValue(" Original system ")
    change(prompt(), "Edited prompt"); change(system(), "Edited system"); change(select(), "2")
    fireEvent.click(screen.getByRole("button", { name: "Try again" })); await flush()
    expect(bodies()[1]).toEqual(bodies()[0])
    runHandler = () => response(reply({ model_id: 2, model_name: "second-model" }))
    fireEvent.click(run()); await flush()
    expect(bodies()[2]).toEqual({ model_id: 2, prompt: "Edited prompt", system_prompt: "Edited system" })
    expect(within(panel()).queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps reply identity and captured pricing when another model is selected", async () => {
    mount(); await submit(); change(select(), "2")
    expect(within(panel()).getByText("first-model")).toBeInTheDocument()
    expect(within(panel()).queryByText("second-model")).not.toBeInTheDocument()
    expect(metric("Latency").getByText("3,758")).toHaveTextContent("3,758 ms")
    expect(metric("Tokens in / out").getByText("1,000 / 200")).toBeInTheDocument()
    expect(metric("Total tokens").getByText("1,200")).toBeInTheDocument()
    expect(metric("Finish reason").getByText("stop")).toBeInTheDocument()
    expect(metric("Est. cost").getByText("$0.00225")).toBeInTheDocument()
    expect(metric("Est. cost").getByText("Based on configured pricing")).toBeInTheDocument()
    expect(within(panel()).queryByRole("link", { name: "Add pricing" })).not.toBeInTheDocument()
  })

  it("treats zero token counts and zero configured rates as valid", async () => {
    modelsHandler = () => response([{ ...model, pricing: { ...model.pricing!, input_usd_per_million_tokens: "0", output_usd_per_million_tokens: "0" } }])
    runHandler = () => response(reply({ input_tokens: 0, output_tokens: 0, total_tokens: 0 }))
    mount(); await submit()
    expect(metric("Tokens in / out").getByText("0 / 0")).toBeInTheDocument()
    expect(metric("Total tokens").getByText("0")).toBeInTheDocument()
    expect(metric("Est. cost").getByText("$0")).toBeInTheDocument()
    expect(metric("Est. cost").getByText("Based on configured pricing")).toBeInTheDocument()
  })

  it.each(["input_tokens", "output_tokens"] as const)("does not estimate a cost when %s is missing", async (missing) => {
    runHandler = () => response(reply({ [missing]: null, total_tokens: null, finish_reason: null }))
    mount(); await submit()
    expect(metric("Est. cost").getByText("—")).toBeInTheDocument()
    expect(metric("Est. cost").getByText("Input and output token usage required to estimate cost")).toBeInTheDocument()
    expect(metric("Tokens in / out").getByText("Some token usage was not reported")).toBeInTheDocument()
    for (const label of ["Total tokens", "Finish reason"]) {
      expect(metric(label).getByText("—")).toBeInTheDocument()
      expect(metric(label).getByText("Not reported by the provider")).toBeInTheDocument()
    }
  })

  it("explains missing pricing and links to Models instead of inventing a cost", async () => {
    modelsHandler = () => response([second]); runHandler = () => response(reply({ model_id: 2, model_name: second.model_name }))
    mount(); await submit()
    expect(metric("Est. cost").getByText(/no price for this model/)).toBeInTheDocument()
    expect(metric("Est. cost").getByRole("link", { name: "Add pricing" })).toHaveAttribute("href", "/models")
    expect(metric("Est. cost").getByText("Configure pricing in Models to estimate cost.")).toBeInTheDocument()
  })

  it.each(["nested", "model", "missing"])("uses the actual %s fetch date for stale pricing, never the effective date", async (source) => {
    const fetched = "2026-09-02T12:00:00Z"
    modelsHandler = () => response([{ ...model, pricing_fetched_at: source === "model" ? fetched : null,
      pricing: { ...model.pricing!, stale: true, fetched_at: source === "nested" ? fetched : null } }])
    mount(); await submit()
    const cost = metric("Est. cost")
    expect(cost.getByText(source === "missing" ? "⚠ stale price · fetch date unavailable" : /⚠ stale price · fetched Sep 2, 2026/)).toBeInTheDocument()
    expect(cost.queryByText(/Jan 1, 2026/)).not.toBeInTheDocument()
  })

  it("renders long identifiers and untrusted reply HTML as complete plain text", async () => {
    const id = "long-model-" + "x".repeat(300)
    const text = '<script>alert("reply")</script><img src=x>' + "y".repeat(500)
    modelsHandler = () => response([{ ...model, model_name: id }]); runHandler = () => response(reply({ model_name: id, response: text }))
    mount(); await submit()
    expect(within(panel()).getByText(id)).toHaveTextContent(id)
    expect(within(panel()).getByText(text)).toHaveTextContent(text)
    expect(panel().querySelector("img, script")).toBeNull()
  })

  it.each(["success", "error"])("ignores late %s after query navigation without overwriting a new reply", async (outcome) => {
    const old = deferred<Response>(); runHandler = () => old.promise
    mount(); await submit()
    fireEvent.click(screen.getByRole("link", { name: "Change query" })); await ready()
    expect(prompt()).toHaveValue("Question")
    expect(within(panel()).getByText("Run a prompt to see the reply here.")).toBeInTheDocument()
    runHandler = () => response(reply({ response: "Current reply" }))
    fireEvent.click(run()); await flush()
    await act(async () => old.resolve(outcome === "success" ? response(reply({ response: "Old reply" })) : response({ detail: "Old provider error" }, 502)))
    expect(within(panel()).getByText("Current reply")).toBeInTheDocument()
    expect(panel()).not.toHaveTextContent("Old reply"); expect(panel()).not.toHaveTextContent("Old provider error")
  })

  it.each(["success", "error"])("ignores late %s after leaving and mounting a new Playground", async (outcome) => {
    const old = deferred<Response>(); runHandler = () => old.promise
    mount(); await submit(); fireEvent.click(screen.getByRole("link", { name: "Leave playground" }))
    expect(screen.getByText("Destination route")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("link", { name: "Return to playground" })); await ready()
    runHandler = () => response(reply({ response: "New visit reply" })); await submit()
    await act(async () => old.resolve(outcome === "success" ? response(reply({ response: "Old visit reply" })) : response({ detail: "Old visit error" }, 502)))
    expect(within(panel()).getByText("New visit reply")).toBeInTheDocument()
    expect(panel()).not.toHaveTextContent("Old visit")
  })

  it.each(["success", "error"])("ignores late model-list %s after query navigation", async (outcome) => {
    const old = deferred<Response>(); modelsHandler = () => old.promise
    mount(); change(prompt(), "Draft survives query"); change(system(), "System survives query")
    modelsHandler = () => response([second]); fireEvent.click(screen.getByRole("link", { name: "Change query" })); await ready()
    await act(async () => old.resolve(outcome === "success" ? response([model]) : response({ detail: "Old models error" }, 503)))
    expect(select()).toHaveValue("2"); expect(screen.queryByRole("option", { name: /First model/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Old models error")).not.toBeInTheDocument()
    expect(prompt()).toHaveValue("Draft survives query"); expect(system()).toHaveValue("System survives query")
  })

  it("reloads availability on query navigation and clears an old reply while retaining the draft", async () => {
    mount(); await submit(); change(system(), "Retained system")
    modelsHandler = () => response([{ ...model, runnable: false, unavailable_reason: "Provider disabled" }, second])
    fireEvent.click(screen.getByRole("link", { name: "Change query" })); await ready()
    expect(select()).toHaveValue("2"); expect(screen.getByRole("option", { name: /Provider disabled/ })).toBeDisabled()
    expect(prompt()).toHaveValue("Question"); expect(system()).toHaveValue("Retained system")
    expect(panel()).not.toHaveTextContent("Paris.")
    expect(within(panel()).getByText("Run a prompt to see the reply here.")).toBeInTheDocument()
    expect(run()).toBeEnabled()
  })

  it.each(["success", "error"])("ignores late model-list %s after leaving and returning", async (outcome) => {
    const old = deferred<Response>(); modelsHandler = () => old.promise
    mount(); fireEvent.click(screen.getByRole("link", { name: "Leave playground" }))
    modelsHandler = () => response([second]); fireEvent.click(screen.getByRole("link", { name: "Return to playground" })); await ready()
    await act(async () => old.resolve(outcome === "success" ? response([model]) : response({ detail: "Abandoned list error" }, 503)))
    expect(select()).toHaveValue("2")
    expect(screen.queryByRole("option", { name: /First model/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Abandoned list error")).not.toBeInTheDocument()
  })

  it("ignores an abandoned model-list retry after a new query load succeeds", async () => {
    modelsHandler = () => response({ detail: "Initial list failure" }, 503)
    mount(); await screen.findByRole("alert")
    const retry = deferred<Response>(); modelsHandler = () => retry.promise
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(select()).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent("Loading models…")
    modelsHandler = () => response([second]); fireEvent.click(screen.getByRole("link", { name: "Change query" })); await ready()
    await act(async () => retry.resolve(response({ detail: "Abandoned retry failure" }, 503)))
    expect(select()).toHaveValue("2")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText("No runnable model. Add one in Models.")).not.toBeInTheDocument()
  })
})
