import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import type {
  EvaluationCostSummary,
  EvaluationPerformanceSummary,
  EvaluationQualitySummary,
  EvaluationRun,
  EvaluationSecuritySummary,
} from "@/api/evaluations"

const RUN_ID = "fe90806e-cf08-4d63-9b60-cc47a46ee0ec"

const run: EvaluationRun = {
  id: RUN_ID,
  status: "completed",
  dataset_id: "1e9df267-fd16-46aa-bad8-82d91b4481fc",
  dataset_name: "Knowledge set",
  repetitions: 1,
  total_requests: 4,
  completed_requests: 4,
  successful_requests: 3,
  failed_requests: 1,
  failure_message: null,
  created_at: "2026-08-23T10:00:00Z",
  started_at: "2026-08-23T10:00:01Z",
  completed_at: "2026-08-23T10:00:02Z",
}

const aggregate = (model_id: string, model_name: string, average_score: number, unavailable_results = 0) => ({
  model_id,
  model_name,
  average_score,
  scored_results: 2 - unavailable_results,
  unavailable_results,
})

const quality: EvaluationQualitySummary = {
  metrics: [
    {
      method: "normalized_exact_match",
      version: 1,
      overall: { average_score: 0.7, scored_results: 3, unavailable_results: 1 },
      by_model: [aggregate("a", "Model A", 0.7), aggregate("b", "Model B", 0.8, 1)],
      by_prompt_version: [],
    },
    {
      method: "normalized_contains_match",
      version: 1,
      overall: { average_score: 0.8, scored_results: 3, unavailable_results: 1 },
      by_model: [aggregate("a", "Model A", 0.8), aggregate("b", "Model B", 0.9, 1)],
      by_prompt_version: [],
    },
  ],
}

const security: EvaluationSecuritySummary = {
  metric_version: 1,
  overall: { score: 0.8, total_tests: 4, passed_tests: 3, failed_tests: 0, unavailable_tests: 1 },
  by_model: [
    { model_id: "a", model_name: "Model A", score: 0.8, total_tests: 2, passed_tests: 2, failed_tests: 0, unavailable_tests: 0 },
    { model_id: "b", model_name: "Model B", score: 0.9, total_tests: 2, passed_tests: 1, failed_tests: 0, unavailable_tests: 1 },
  ],
  by_prompt_version: [],
}

const performance: EvaluationPerformanceSummary = {
  latency: { average_ms: 95, minimum_ms: 80, maximum_ms: 110, recorded_results: 3, unavailable_results: 1 },
  latency_by_model: [
    { model_id: "a", model_name: "Model A", average_ms: 100, minimum_ms: 90, maximum_ms: 110, recorded_results: 2, unavailable_results: 0 },
    { model_id: "b", model_name: "Model B", average_ms: 80, minimum_ms: 80, maximum_ms: 80, recorded_results: 1, unavailable_results: 1 },
  ],
  input_tokens: { sum_tokens: 30, recorded_results: 3, unavailable_results: 1 },
  output_tokens: { sum_tokens: 20, recorded_results: 3, unavailable_results: 1 },
  total_tokens: { sum_tokens: 50, recorded_results: 3, unavailable_results: 1 },
  token_usage_by_model: [
    {
      model_id: "a",
      model_name: "Model A",
      input_tokens: { sum_tokens: 20, recorded_results: 2, unavailable_results: 0 },
      output_tokens: { sum_tokens: 10, recorded_results: 2, unavailable_results: 0 },
      total_tokens: { sum_tokens: 30, recorded_results: 2, unavailable_results: 0 },
    },
    {
      model_id: "b",
      model_name: "Model B",
      input_tokens: { sum_tokens: 10, recorded_results: 1, unavailable_results: 1 },
      output_tokens: { sum_tokens: 10, recorded_results: 1, unavailable_results: 1 },
      total_tokens: { sum_tokens: 20, recorded_results: 1, unavailable_results: 1 },
    },
  ],
}

const cost: EvaluationCostSummary = {
  overall: { estimated_usd: "0.003", priced_results: 3, unavailable_results: 1 },
  average_complete_test_case_usd: "0.001",
  complete_test_cases: 1,
  incomplete_test_cases: 1,
  by_model: [
    { model_id: "a", model_name: "Model A", estimated_usd: "0.002", priced_results: 2, unavailable_results: 0 },
    { model_id: "b", model_name: "Model B", estimated_usd: "0.001", priced_results: 1, unavailable_results: 1 },
  ],
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
}

describe("dashboard", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path === "/api/evaluations?offset=0&limit=20") {
        return jsonResponse({ items: [run], total: 1, completed: 1, failed: 0, offset: 0, limit: 20 })
      }
      if (path.endsWith("/quality-summary")) return jsonResponse(quality)
      if (path.endsWith("/security-summary")) return jsonResponse(security)
      if (path.endsWith("/performance-summary")) return jsonResponse(performance)
      if (path.endsWith("/cost-summary")) return jsonResponse(cost)
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  it("shows the newest completed run and compares only complete model metrics", async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><App /></MemoryRouter>)

    expect(await screen.findByRole("heading", { name: "Knowledge set" })).toBeInTheDocument()
    expect((await screen.findAllByText("80%")).length).toBeGreaterThan(0)
    expect(screen.getByText("Exact 70%")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Model comparison" }))
    expect(
      screen.getByRole("img", { name: /Relative model profile/ }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Model A" }))
    expect(screen.getByRole("button", { name: "Model A" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    const modelA = await screen.findByRole("row", { name: /Model A/ })
    const modelB = screen.getByRole("row", { name: /Model B/ })
    expect(within(modelA).getAllByText("Best")).toHaveLength(4)
    expect(within(modelB).queryByText("Best")).not.toBeInTheDocument()
    expect(within(modelB).getAllByText("1 unavailable").length).toBeGreaterThan(0)
    expect(
      fetchMock.mock.calls
        .map(([input]) => String(input))
        .filter((path) => path.includes("summary"))
        .every((path) => path.includes(RUN_ID)),
    ).toBe(true)
  })
})
