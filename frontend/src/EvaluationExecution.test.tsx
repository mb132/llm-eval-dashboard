import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import type {
  EvaluationOptions,
  EvaluationPreview,
  EvaluationResult,
  EvaluationRun,
} from "@/api/evaluations"

const RUN_ID = "fe90806e-cf08-4d63-9b60-cc47a46ee0ec"
const DATASET_ID = "1e9df267-fd16-46aa-bad8-82d91b4481fc"
const VERSION_ID = "87ad64a0-6206-4921-a102-92b75fc25188"

const options: EvaluationOptions = {
  models: [{ id: "1", provider: "ollama", name: "Local model", model_name: "local-model:latest" }],
  prompt_versions: [
    {
      id: VERSION_ID,
      prompt_id: "21c71d8a-1dc7-4efe-9d4d-134c0b72fc2e",
      prompt_name: "Knowledge prompt",
      version_number: 1,
      content_preview: "Answer exactly: {{input}}",
    },
  ],
  datasets: [{ id: DATASET_ID, name: "Knowledge set", test_case_count: 1 }],
}

const preview: EvaluationPreview = {
  model_ids: ["1"],
  prompt_version_ids: [VERSION_ID],
  dataset_id: DATASET_ID,
  repetitions: 1,
  model_count: 1,
  prompt_version_count: 1,
  test_case_count: 1,
  combination_count: 1,
  total_requests: 1,
}

const completedRun: EvaluationRun = {
  id: RUN_ID,
  status: "completed",
  dataset_id: DATASET_ID,
  dataset_name: "Knowledge set",
  repetitions: 1,
  total_requests: 1,
  completed_requests: 1,
  successful_requests: 1,
  failed_requests: 0,
  failure_message: null,
  created_at: "2026-08-23T10:00:00Z",
  started_at: "2026-08-23T10:00:01Z",
  completed_at: "2026-08-23T10:00:02Z",
}

const result: EvaluationResult = {
  id: "c84899a0-4956-464e-a364-ec93c7817bf3",
  sequence_number: 1,
  status: "succeeded",
  model_id: "1",
  model_provider: "ollama",
  model_name: "Local model",
  reported_model_name: "local-model:latest",
  prompt_id: "21c71d8a-1dc7-4efe-9d4d-134c0b72fc2e",
  prompt_version_id: VERSION_ID,
  prompt_name: "Knowledge prompt",
  prompt_version_number: 1,
  test_case_id: "f0d638d3-3545-4890-be30-8f026fc967a2",
  repetition: 1,
  max_output_tokens: 1024,
  test_input: "Capital of France?",
  expected_output: "Paris",
  generated_output: "Paris",
  error_code: null,
  error_message: null,
  latency_ms: 120,
  input_tokens: null,
  output_tokens: 1,
  started_at: "2026-08-23T10:00:01Z",
  completed_at: "2026-08-23T10:00:02Z",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe("evaluation execution", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("starts the reviewed configuration and opens its persistent run", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(options))
      .mockResolvedValueOnce(jsonResponse(preview))
      .mockResolvedValueOnce(jsonResponse({ ...completedRun, status: "pending" }, 202))
      .mockResolvedValueOnce(jsonResponse(completedRun))
      .mockResolvedValueOnce(
        jsonResponse({ items: [result], total: 1, offset: 0, limit: 50 }),
      )
    renderApp("/")

    await user.click(await screen.findByRole("checkbox", { name: /Version 1/ }))
    await user.click(screen.getByRole("radio", { name: /Knowledge set/ }))
    await user.click(screen.getByRole("button", { name: "Review configuration" }))
    await user.click(await screen.findByRole("button", { name: "Start evaluation" }))

    expect(
      await screen.findByRole("heading", { name: "Evaluation run" }),
    ).toBeInTheDocument()
    const startCall = fetchMock.mock.calls[2]
    expect(String(startCall[0])).toBe("/api/evaluations")
    expect(JSON.parse(String(startCall[1]?.body))).toEqual({
      model_ids: ["1"],
      prompt_version_ids: [VERSION_ID],
      dataset_id: DATASET_ID,
      repetitions: 1,
    })
  })

  it("shows live progress and pending result states", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ...completedRun,
          status: "running",
          total_requests: 3,
          completed_requests: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              ...result,
              status: "running",
              generated_output: null,
              latency_ms: null,
              output_tokens: null,
            },
          ],
          total: 3,
          offset: 0,
          limit: 50,
        }),
      )
    renderApp(`/evaluations/${RUN_ID}`)

    expect(await screen.findAllByText("Running")).toHaveLength(2)
    expect(screen.getByText("1 completed")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "3")
    expect(screen.getByText("Waiting for the model response…")).toBeInTheDocument()
  })

  it("renders stored outputs as text and loads further completed results", async () => {
    const user = userEvent.setup()
    const unsafe = '<img src="x" onerror="alert(1)">'
    const first = { ...result, generated_output: unsafe }
    const second = {
      ...result,
      id: "df9aefc8-e0c2-43c6-8776-b2b782f7aaf4",
      sequence_number: 2,
      test_input: "2 + 2?",
      expected_output: "4",
      generated_output: "4",
    }
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ...completedRun, total_requests: 2, completed_requests: 2 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [first], total: 2, offset: 0, limit: 50 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [second], total: 2, offset: 1, limit: 50 }),
      )
    const { container } = renderApp(`/evaluations/${RUN_ID}`)

    expect(await screen.findByText(unsafe)).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("Unavailable")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Load more results" }))
    await waitFor(() => expect(screen.getByText("2 + 2?")).toBeInTheDocument())
  })
})
