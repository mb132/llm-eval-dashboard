import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import type {
  EvaluationCostSummary,
  EvaluationOptions,
  EvaluationPerformanceSummary,
  EvaluationPreview,
  EvaluationQualitySummary,
  EvaluationResult,
  EvaluationRun,
  EvaluationSecuritySummary,
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

const qualitySummary: EvaluationQualitySummary = {
  metrics: [
    {
      method: "normalized_exact_match",
      version: 1,
      overall: {
        average_score: 1,
        scored_results: 1,
        unavailable_results: 0,
      },
      by_model: [
        {
          model_id: "1",
          model_name: "Local model",
          average_score: 1,
          scored_results: 1,
          unavailable_results: 0,
        },
      ],
      by_prompt_version: [
        {
          prompt_version_id: VERSION_ID,
          prompt_name: "Knowledge prompt",
          prompt_version_number: 1,
          average_score: 1,
          scored_results: 1,
          unavailable_results: 0,
        },
      ],
    },
    {
      method: "normalized_contains_match",
      version: 1,
      overall: {
        average_score: 1,
        scored_results: 1,
        unavailable_results: 0,
      },
      by_model: [],
      by_prompt_version: [],
    },
  ],
}

const securitySummary: EvaluationSecuritySummary = {
  metric_version: 1,
  overall: {
    score: null,
    total_tests: 0,
    passed_tests: 0,
    failed_tests: 0,
    unavailable_tests: 0,
  },
  by_model: [],
  by_prompt_version: [],
}

const performanceSummary: EvaluationPerformanceSummary = {
  latency: {
    average_ms: 120,
    minimum_ms: 120,
    maximum_ms: 120,
    recorded_results: 1,
    unavailable_results: 0,
  },
  latency_by_model: [
    {
      model_id: "1",
      model_name: "Local model",
      average_ms: 120,
      minimum_ms: 120,
      maximum_ms: 120,
      recorded_results: 1,
      unavailable_results: 0,
    },
  ],
  input_tokens: { sum_tokens: null, recorded_results: 0, unavailable_results: 1 },
  output_tokens: { sum_tokens: 1, recorded_results: 1, unavailable_results: 0 },
  total_tokens: { sum_tokens: null, recorded_results: 0, unavailable_results: 1 },
  token_usage_by_model: [
    {
      model_id: "1",
      model_name: "Local model",
      input_tokens: { sum_tokens: null, recorded_results: 0, unavailable_results: 1 },
      output_tokens: { sum_tokens: 1, recorded_results: 1, unavailable_results: 0 },
      total_tokens: { sum_tokens: null, recorded_results: 0, unavailable_results: 1 },
    },
  ],
}

const costSummary: EvaluationCostSummary = {
  overall: {
    estimated_usd: "0.000003000",
    priced_results: 1,
    unavailable_results: 0,
  },
  average_complete_test_case_usd: "0.000003000",
  complete_test_cases: 1,
  incomplete_test_cases: 0,
  by_model: [
    {
      model_id: "1",
      model_name: "Local model",
      estimated_usd: "0.000003000",
      priced_results: 1,
      unavailable_results: 0,
    },
  ],
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
  case_type: "standard",
  security_test_type: null,
  security_metric_version: null,
  security_status: null,
  repetition: 1,
  max_output_tokens: 1024,
  rendered_prompt: "Answer exactly: Capital of France?",
  test_input: "Capital of France?",
  expected_output: "Paris",
  generated_output: "Paris",
  error_code: null,
  error_message: null,
  latency_ms: 120,
  input_tokens: null,
  output_tokens: 1,
  total_tokens: null,
  pricing: null,
  estimated_cost_usd: null,
  quality_scores: [
    { method: "normalized_exact_match", version: 1, score: 1 },
    { method: "normalized_contains_match", version: 1, score: 1 },
  ],
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
      .mockResolvedValueOnce(jsonResponse(qualitySummary))
      .mockResolvedValueOnce(jsonResponse(securitySummary))
      .mockResolvedValueOnce(jsonResponse(performanceSummary))
      .mockResolvedValueOnce(jsonResponse(costSummary))
    renderApp("/evaluations/new")

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
              total_tokens: null,
              quality_scores: result.quality_scores.map((quality) => ({
                ...quality,
                score: null,
              })),
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
      .mockResolvedValueOnce(jsonResponse(qualitySummary))
      .mockResolvedValueOnce(jsonResponse(securitySummary))
      .mockResolvedValueOnce(jsonResponse(performanceSummary))
      .mockResolvedValueOnce(jsonResponse(costSummary))
      .mockResolvedValueOnce(
        jsonResponse({ items: [second], total: 2, offset: 1, limit: 50 }),
      )
    const { container } = renderApp(`/evaluations/${RUN_ID}`)

    expect(await screen.findByText(unsafe)).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0)
    expect(screen.getByText("Answer exactly: Capital of France?")).toBeInTheDocument()
    expect(
      screen.getAllByRole("heading", { name: "Normalized exact match" }),
    ).toHaveLength(1)
    expect(screen.getByText("Normalized exact match v1")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Estimated costs" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Load more results" }))
    await waitFor(() => expect(screen.getByText("2 + 2?")).toBeInTheDocument())
  })

  it("shows security outcomes and the conservative denominator", async () => {
    const assessed = {
      ...result,
      case_type: "security" as const,
      security_test_type: "direct_prompt_injection" as const,
      security_metric_version: 1,
      security_status: "failed" as const,
      expected_output: "SECURITY_TEST_FAILED",
      generated_output: "SECURITY_TEST_FAILED",
      quality_scores: [],
    }
    const summary: EvaluationSecuritySummary = {
      metric_version: 1,
      overall: {
        score: 1 / 3,
        total_tests: 3,
        passed_tests: 1,
        failed_tests: 1,
        unavailable_tests: 1,
      },
      by_model: [],
      by_prompt_version: [],
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(completedRun))
      .mockResolvedValueOnce(
        jsonResponse({ items: [assessed], total: 1, offset: 0, limit: 50 }),
      )
      .mockResolvedValueOnce(jsonResponse(qualitySummary))
      .mockResolvedValueOnce(jsonResponse(summary))
      .mockResolvedValueOnce(jsonResponse(performanceSummary))
      .mockResolvedValueOnce(jsonResponse(costSummary))
    renderApp(`/evaluations/${RUN_ID}`)

    expect(
      await screen.findByRole("heading", { name: "Security score" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText("1 passed · 1 failed · 1 unavailable · 3 total"),
    ).toBeInTheDocument()
    expect(screen.getByText("Failure marker")).toBeInTheDocument()
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })
})
