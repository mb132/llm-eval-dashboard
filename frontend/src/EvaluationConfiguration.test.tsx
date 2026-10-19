import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Link, MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { EvaluationPage } from "@/pages/EvaluationPage"
import type { EvaluationOptions, EvaluationPreview } from "@/api/evaluations"

const DATASET_ID = "1e9df267-fd16-46aa-bad8-82d91b4481fc"
const VERSION_ONE_ID = "87ad64a0-6206-4921-a102-92b75fc25188"
const VERSION_TWO_ID = "c84899a0-4956-464e-a364-ec93c7817bf3"

const options: EvaluationOptions = {
  models: [
    { id: "model-a", provider: "ollama", name: "Model A", model_name: "model-a:latest" },
    { id: "model-b", provider: "ollama", name: "Model B", model_name: "model-b:latest" },
  ],
  prompt_versions: [
    {
      id: VERSION_TWO_ID,
      prompt_id: "21c71d8a-1dc7-4efe-9d4d-134c0b72fc2e",
      prompt_name: "General knowledge",
      version_number: 2,
      content_preview: "Answer clearly. {{input}}",
      system_prompt_preview: null,
    },
    {
      id: VERSION_ONE_ID,
      prompt_id: "21c71d8a-1dc7-4efe-9d4d-134c0b72fc2e",
      prompt_name: "General knowledge",
      version_number: 1,
      content_preview: "Answer accurately. {{input}}",
      system_prompt_preview: null,
    },
  ],
  datasets: [
    { id: DATASET_ID, name: "Knowledge set", test_case_count: 2 },
  ],
}

const preview: EvaluationPreview = {
  model_ids: ["model-a", "model-b"],
  prompt_version_ids: [VERSION_TWO_ID, VERSION_ONE_ID],
  dataset_id: DATASET_ID,
  repetitions: 2,
  model_count: 2,
  prompt_version_count: 2,
  test_case_count: 2,
  combination_count: 4,
  total_requests: 16,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderEvaluation() {
  return render(
    <MemoryRouter initialEntries={["/evaluations/new"]}>
      <App />
    </MemoryRouter>,
  )
}

describe("evaluation configuration", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/models" ? Promise.resolve(jsonResponse([])) : fetchMock(input, init))
  })

  it("previews multiple models and prompt versions with the exact request", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(options))
      .mockResolvedValueOnce(jsonResponse(preview))
    renderEvaluation()

    expect(
      await screen.findByRole("heading", { name: "New evaluation" }),
    ).toBeInTheDocument()
    const reviewButton = screen.getByRole("button", { name: "Start evaluation" })
    expect(reviewButton).toBeDisabled()

    await user.click(await screen.findByRole("checkbox", { name: /Model A/ }))
    await user.click(screen.getByRole("checkbox", { name: /Model B/ }))
    await user.click(screen.getByRole("checkbox", { name: /v2/ }))
    await user.click(screen.getByRole("checkbox", { name: /v1/ }))
    await user.click(screen.getByRole("radio", { name: /Knowledge set/ }))
    await user.click(within(screen.getByRole("group", { name: "Repetitions" })).getByRole("radio", { name: "2" }))

    expect(
      await screen.findByText("Configuration valid"),
    ).toBeInTheDocument()
    expect(screen.getByText("Total requests").nextSibling).toHaveTextContent(
      "16",
    )
    const previewCall = fetchMock.mock.calls[1]
    expect(String(previewCall[0])).toBe("/api/evaluations/preview")
    expect(JSON.parse(String(previewCall[1]?.body))).toEqual({
      model_ids: ["model-a", "model-b"],
      prompt_version_ids: [VERSION_TWO_ID, VERSION_ONE_ID],
      dataset_id: DATASET_ID,
      repetitions: 2,
    })

    await user.click(screen.getByRole("checkbox", { name: /Model B/ }))
    expect(
      screen.queryByText("Configuration valid"),
    ).not.toBeInTheDocument()
  })

  it("preselects the temporary model when it is the only model", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...options, models: [options.models[0]] }),
    )
    renderEvaluation()

    expect(
      await screen.findByRole("checkbox", { name: /Model A/ }),
    ).toBeChecked()
  })

  it("shows useful links when prompts and datasets are missing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ models: options.models, prompt_versions: [], datasets: [] }),
    )
    renderEvaluation()

    expect(await screen.findByText(/No prompt versions exist yet/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Create a prompt" })).toHaveAttribute(
      "href",
      "/prompts",
    )
    expect(screen.getByRole("link", { name: "Create a dataset" })).toHaveAttribute(
      "href",
      "/datasets",
    )
  })

  it("renders untrusted option text without interpreting HTML", async () => {
    const unsafe = '<img src="x" onerror="alert(1)">'
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...options,
        models: [{ ...options.models[0], name: unsafe }],
        prompt_versions: [
          { ...options.prompt_versions[0], content_preview: unsafe },
        ],
      }),
    )
    const { container } = renderEvaluation()

    expect(await screen.findAllByText(unsafe)).toHaveLength(2)
    expect(container.querySelector("img")).toBeNull()
  })

  it("shows sanitized option and preview errors", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse(options))
    renderEvaluation()
    await screen.findByRole("heading", { name: "New evaluation" })

    await user.click(await screen.findByRole("checkbox", { name: /Model A/ }))
    await user.click(screen.getByRole("checkbox", { name: /v2/ }))
    await user.click(screen.getByRole("radio", { name: /Knowledge set/ }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Configuration exceeds the safe request limit." }, 422),
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Configuration exceeds the safe request limit.",
    )

    await user.click(await screen.findByRole("checkbox", { name: /Model A/ }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })

  async function selectComplete(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("checkbox", { name: /Model A/ }))
    await user.click(screen.getByRole("checkbox", { name: /v2/ }))
    await user.click(screen.getByRole("radio", { name: /Knowledge set/ }))
  }

  it("debounces automatic validation and disables Start immediately after changes", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse(options)).mockResolvedValue(jsonResponse(preview))
    renderEvaluation()
    await screen.findByRole("checkbox", { name: /Model A/ })
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole("checkbox", { name: /Model A/ }))
      fireEvent.click(screen.getByRole("checkbox", { name: /v2/ }))
      fireEvent.click(screen.getByRole("radio", { name: /Knowledge set/ }))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(screen.getByText("Total requests").nextSibling).toHaveTextContent("2")
      await act(async () => { await vi.advanceTimersByTimeAsync(299) })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(screen.getByRole("button", { name: "Start evaluation" })).toBeEnabled()
      fireEvent.click(screen.getByRole("checkbox", { name: /Model B/ }))
      expect(screen.getByRole("button", { name: "Start evaluation" })).toBeDisabled()
      expect(screen.getByText("Total requests").nextSibling).toHaveTextContent("4")
    } finally { vi.useRealTimers() }
    await user.click(screen.getByRole("checkbox", { name: /Model A/ }))
  })

  it.each([200, 422])("ignores stale out-of-order preview responses with status %s", async (status) => {
    const user = userEvent.setup()
    let resolveOld!: (value: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse(options))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce(jsonResponse(preview))
    renderEvaluation()
    await selectComplete(user)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole("checkbox", { name: /Model B/ }))
    await screen.findByText("Configuration valid")
    await act(async () => { resolveOld(jsonResponse(status === 200 ? preview : { detail: "Old selection rejected" }, status)) })
    expect(screen.getByRole("button", { name: "Start evaluation" })).toBeEnabled()
    expect(screen.queryByText("Old selection rejected")).not.toBeInTheDocument()
    expect(screen.getByText("Total requests").nextSibling).toHaveTextContent("4")
  })

  it("retries preview errors without enabling Start before validation", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse(options))
      .mockResolvedValueOnce(new Response("<html>private server trace</html>", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(preview))
    renderEvaluation()
    await selectComplete(user)
    expect(await screen.findByRole("alert")).toHaveTextContent("The evaluation configuration could not be processed.")
    expect(screen.queryByText(/private server trace/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start evaluation" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(screen.getByRole("button", { name: "Start evaluation" })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole("button", { name: "Start evaluation" })).toBeEnabled())
  })

  it("retries a failed start and navigates using the exact current configuration", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse(options)).mockResolvedValueOnce(jsonResponse(preview))
      .mockResolvedValueOnce(jsonResponse({ detail: "Try starting again." }, 503))
      .mockResolvedValueOnce(jsonResponse({ id: "new-run" }))
    render(<MemoryRouter initialEntries={["/evaluations/new"]}><Routes><Route path="/evaluations/new" element={<EvaluationPage />} /><Route path="/evaluations/:id" element={<p>New run destination</p>} /></Routes></MemoryRouter>)
    await selectComplete(user)
    await waitFor(() => expect(screen.getByRole("button", { name: "Start evaluation" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "Start evaluation" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Try starting again.")
    await user.click(screen.getByRole("button", { name: "Start evaluation" }))
    expect(await screen.findByText("New run destination")).toBeInTheDocument()
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({ model_ids: ["model-a"], prompt_version_ids: [VERSION_TWO_ID], dataset_id: DATASET_ID, repetitions: 1 })
  })

  it("keeps the header and step skeletons while loading and retries loading errors", async () => {
    const user = userEvent.setup()
    let rejectLoad!: (error: Error) => void
    fetchMock.mockImplementationOnce(() => new Promise((_, reject) => { rejectLoad = reject }))
      .mockResolvedValueOnce(jsonResponse({ models: [], prompt_versions: [], datasets: [] }))
    renderEvaluation()
    expect(screen.getByRole("heading", { name: "New evaluation" })).toBeInTheDocument()
    expect(screen.getByText("Loading evaluation options…")).toHaveAttribute("role", "status")
    expect(screen.getByRole("group", { name: "1 Models" })).toBeInTheDocument()
    await act(async () => { rejectLoad(new Error("offline")) })
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach FastAPI")
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("No runnable models. Add one in Models.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Add a model" })).toHaveAttribute("href", "/models")
    expect(screen.getByRole("button", { name: "Start evaluation" })).toBeDisabled()
  })

  it("uses named native inputs, actual legends, select all, and keyboard radio selection", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse(options))
    renderEvaluation()
    await screen.findByRole("checkbox", { name: /Model A/ })
    await user.click(screen.getByRole("button", { name: "Select all" }))
    expect(screen.getByRole("checkbox", { name: /Model A/ })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: /Model B/ })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: /Model A/ })).toHaveAttribute("name", "models")
    for (const [index, title] of ["Models", "Prompt versions", "Dataset", "Repetitions"].entries()) {
      const group = screen.getByRole("group", { name: `${index + 1} ${title}` })
      expect(group.tagName).toBe("FIELDSET")
      expect(group.querySelector("legend")).toHaveTextContent(title)
    }
    const repetitions = screen.getByRole("group", { name: "Repetitions" })
    const one = within(repetitions).getByRole("radio", { name: "1" })
    expect(one).toHaveAttribute("name", "repetitions")
    one.focus()
    await user.keyboard("{ArrowRight}")
    expect(within(repetitions).getByRole("radio", { name: "2" })).toBeChecked()
    expect(screen.queryByRole("button", { name: "Review configuration" })).not.toBeInTheDocument()
  })

  it("shows disabled active models with reasons and honest pricing metadata", async () => {
    const user = userEvent.setup()
    const modelDetail = { id: 1, display_name: "No price model", provider: { kind: "openrouter" }, model_name: "no-price", active: true, runnable: true, unavailable_reason: null, pricing: null }
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/models"
      ? Promise.resolve(jsonResponse([modelDetail, { ...modelDetail, id: 2, display_name: "Disabled model", runnable: false, unavailable_reason: "Provider has no API key." }])) : fetchMock(input, init))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...options, models: [{ id: "1", name: "No price model", provider: "openrouter", model_name: "no-price", pricing_unavailable: false }] }))
    renderEvaluation()
    expect(await screen.findByRole("checkbox", { name: /No price model/ })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: /Disabled model/ })).toBeDisabled()
    expect(screen.getByText("Provider has no API key.")).toBeInTheDocument()
    expect(screen.getAllByText("⚠ no price", { selector: "span" })).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: "Select all" }))
    expect(screen.getByRole("checkbox", { name: /Disabled model/ })).not.toBeChecked()
  })

  it("retains system previews and stale pricing warnings as text", async () => {
    const unsafe = '<script>alert("unsafe")</script>'
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...options,
      models: [{ ...options.models[0], pricing_stale: true }],
      prompt_versions: [{ ...options.prompt_versions[0], system_prompt_preview: unsafe }],
    }))
    const { container } = renderEvaluation()
    expect(await screen.findByText(`System: ${unsafe}`)).toBeInTheDocument()
    expect(container.querySelector("script")).toBeNull()
    expect(screen.getByText(/This run will use the last saved estimate/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Add pricing" })).toHaveAttribute("href", "/models")
  })

  it("shows inactive metadata models disabled with an inactive reason", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/models"
        ? Promise.resolve(jsonResponse([{
            id: 3,
            display_name: "Inactive model",
            provider: { kind: "ollama" },
            model_name: "inactive",
            active: false,
            runnable: false,
            unavailable_reason: null,
            pricing: null,
          }]))
        : fetchMock(input, init),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(options))
    renderEvaluation()
    expect(await screen.findByRole("checkbox", { name: /Inactive model/ })).toBeDisabled()
    expect(screen.getByText("Inactive model.")).toBeInTheDocument()
    expect(screen.getByText("0 of 2 runnable")).toBeInTheDocument()
  })

  it.each([200, 503])("ignores Start completion after navigating away with status %s", async (status) => {
    const user = userEvent.setup()
    let resolveStart!: (value: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse(options))
      .mockResolvedValueOnce(jsonResponse(preview))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve }))
    render(
      <MemoryRouter initialEntries={["/evaluations/new"]}>
        <Routes>
          <Route path="/evaluations/new" element={<><Link to="/away">Leave setup</Link><EvaluationPage /></>} />
          <Route path="/away" element={<p>Another page</p>} />
          <Route path="/evaluations/:id" element={<p>Unexpected run destination</p>} />
        </Routes>
      </MemoryRouter>,
    )
    await selectComplete(user)
    await waitFor(() => expect(screen.getByRole("button", { name: "Start evaluation" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "Start evaluation" }))
    await user.click(screen.getByRole("link", { name: "Leave setup" }))
    expect(screen.getByText("Another page")).toBeInTheDocument()
    await act(async () => {
      resolveStart(jsonResponse(status === 200 ? { id: "new-run" } : { detail: "Late start failure" }, status))
    })
    expect(screen.getByText("Another page")).toBeInTheDocument()
    expect(screen.queryByText("Unexpected run destination")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps Start and selections disabled while starting and prevents duplicate starts", async () => {
    const user = userEvent.setup()
    let resolveStart!: (value: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse(options)).mockResolvedValueOnce(jsonResponse(preview))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve }))
    renderEvaluation()
    await selectComplete(user)
    await waitFor(() => expect(screen.getByRole("button", { name: "Start evaluation" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "Start evaluation" }))
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: /Model A/ })).toBeDisabled()
    expect(screen.getByRole("radio", { name: /Knowledge set/ })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Starting…" }))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await act(async () => { resolveStart(jsonResponse({ detail: "Could not start." }, 503)) })
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start.")
    expect(screen.getByRole("button", { name: "Start evaluation" })).toBeEnabled()
  })
})
