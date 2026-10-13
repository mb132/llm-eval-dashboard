import { act, render, screen, within } from "@testing-library/react"
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
const PROMPT_ONE_ID = "87ad64a0-6206-4921-a102-92b75fc25188"
const PROMPT_TWO_ID = "c84899a0-4956-464e-a364-ec93c7817bf3"

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

const aggregate = (
  model_id: string,
  model_name: string,
  average_score: number,
  unavailable_results = 0,
) => ({
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
      overall: {
        average_score: 0.7,
        scored_results: 3,
        unavailable_results: 1,
      },
      by_model: [
        aggregate("a", "Model A", 0.7),
        aggregate("b", "Model B", 0.8, 1),
      ],
      by_prompt_version: [
        {
          prompt_version_id: PROMPT_ONE_ID,
          prompt_name: "Knowledge prompt",
          prompt_version_number: 1,
          average_score: 0.7,
          scored_results: 2,
          unavailable_results: 0,
        },
        {
          prompt_version_id: PROMPT_TWO_ID,
          prompt_name: "Knowledge prompt",
          prompt_version_number: 2,
          average_score: 0.8,
          scored_results: 1,
          unavailable_results: 1,
        },
      ],
    },
    {
      method: "normalized_contains_match",
      version: 1,
      overall: {
        average_score: 0.8,
        scored_results: 3,
        unavailable_results: 1,
      },
      by_model: [
        aggregate("a", "Model A", 0.8),
        aggregate("b", "Model B", 0.9, 1),
      ],
      by_prompt_version: [
        {
          prompt_version_id: PROMPT_ONE_ID,
          prompt_name: "Knowledge prompt",
          prompt_version_number: 1,
          average_score: 0.8,
          scored_results: 2,
          unavailable_results: 0,
        },
        {
          prompt_version_id: PROMPT_TWO_ID,
          prompt_name: "Knowledge prompt",
          prompt_version_number: 2,
          average_score: 0.9,
          scored_results: 1,
          unavailable_results: 1,
        },
      ],
    },
  ],
}

const security: EvaluationSecuritySummary = {
  metric_version: 1,
  overall: {
    score: 0.8,
    total_tests: 4,
    passed_tests: 3,
    failed_tests: 0,
    unavailable_tests: 1,
  },
  by_model: [
    {
      model_id: "a",
      model_name: "Model A",
      score: 0.8,
      total_tests: 2,
      passed_tests: 2,
      failed_tests: 0,
      unavailable_tests: 0,
    },
    {
      model_id: "b",
      model_name: "Model B",
      score: 0.9,
      total_tests: 2,
      passed_tests: 1,
      failed_tests: 0,
      unavailable_tests: 1,
    },
  ],
  by_prompt_version: [
    {
      prompt_version_id: PROMPT_ONE_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 1,
      score: 0.5,
      total_tests: 2,
      passed_tests: 1,
      failed_tests: 1,
      unavailable_tests: 0,
    },
    {
      prompt_version_id: PROMPT_TWO_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 2,
      score: 0.5,
      total_tests: 2,
      passed_tests: 1,
      failed_tests: 0,
      unavailable_tests: 1,
    },
  ],
}

const performance: EvaluationPerformanceSummary = {
  latency: {
    average_ms: 95,
    minimum_ms: 80,
    maximum_ms: 110,
    recorded_results: 3,
    unavailable_results: 1,
  },
  latency_by_model: [
    {
      model_id: "a",
      model_name: "Model A",
      average_ms: 100,
      minimum_ms: 90,
      maximum_ms: 110,
      recorded_results: 2,
      unavailable_results: 0,
    },
    {
      model_id: "b",
      model_name: "Model B",
      average_ms: 80,
      minimum_ms: 80,
      maximum_ms: 80,
      recorded_results: 1,
      unavailable_results: 1,
    },
  ],
  latency_by_prompt_version: [
    {
      prompt_version_id: PROMPT_ONE_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 1,
      average_ms: 100,
      minimum_ms: 90,
      maximum_ms: 110,
      recorded_results: 2,
      unavailable_results: 0,
    },
    {
      prompt_version_id: PROMPT_TWO_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 2,
      average_ms: 80,
      minimum_ms: 80,
      maximum_ms: 80,
      recorded_results: 1,
      unavailable_results: 1,
    },
  ],
  input_tokens: { sum_tokens: 30, recorded_results: 3, unavailable_results: 1 },
  output_tokens: {
    sum_tokens: 20,
    recorded_results: 3,
    unavailable_results: 1,
  },
  total_tokens: { sum_tokens: 50, recorded_results: 3, unavailable_results: 1 },
  token_usage_by_model: [
    {
      model_id: "a",
      model_name: "Model A",
      input_tokens: {
        sum_tokens: 20,
        recorded_results: 2,
        unavailable_results: 0,
      },
      output_tokens: {
        sum_tokens: 10,
        recorded_results: 2,
        unavailable_results: 0,
      },
      total_tokens: {
        sum_tokens: 30,
        recorded_results: 2,
        unavailable_results: 0,
      },
    },
    {
      model_id: "b",
      model_name: "Model B",
      input_tokens: {
        sum_tokens: 10,
        recorded_results: 1,
        unavailable_results: 1,
      },
      output_tokens: {
        sum_tokens: 10,
        recorded_results: 1,
        unavailable_results: 1,
      },
      total_tokens: {
        sum_tokens: 20,
        recorded_results: 1,
        unavailable_results: 1,
      },
    },
  ],
  token_usage_by_prompt_version: [
    {
      prompt_version_id: PROMPT_ONE_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 1,
      input_tokens: {
        sum_tokens: 20,
        recorded_results: 2,
        unavailable_results: 0,
      },
      output_tokens: {
        sum_tokens: 10,
        recorded_results: 2,
        unavailable_results: 0,
      },
      total_tokens: {
        sum_tokens: 30,
        recorded_results: 2,
        unavailable_results: 0,
      },
    },
    {
      prompt_version_id: PROMPT_TWO_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 2,
      input_tokens: {
        sum_tokens: 10,
        recorded_results: 1,
        unavailable_results: 1,
      },
      output_tokens: {
        sum_tokens: 10,
        recorded_results: 1,
        unavailable_results: 1,
      },
      total_tokens: {
        sum_tokens: 20,
        recorded_results: 1,
        unavailable_results: 1,
      },
    },
  ],
}

const cost: EvaluationCostSummary = {
  overall: {
    estimated_usd: "0.003",
    priced_results: 3,
    unavailable_results: 1,
  },
  average_complete_test_case_usd: "0.001",
  complete_test_cases: 1,
  incomplete_test_cases: 1,
  by_model: [
    {
      model_id: "a",
      model_name: "Model A",
      estimated_usd: "0.002",
      priced_results: 2,
      unavailable_results: 0,
    },
    {
      model_id: "b",
      model_name: "Model B",
      estimated_usd: "0.001",
      priced_results: 1,
      unavailable_results: 1,
    },
  ],
  by_prompt_version: [
    {
      prompt_version_id: PROMPT_ONE_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 1,
      estimated_usd: "0.002",
      priced_results: 2,
      unavailable_results: 0,
    },
    {
      prompt_version_id: PROMPT_TWO_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 2,
      estimated_usd: "0.001",
      priced_results: 1,
      unavailable_results: 1,
    },
  ],
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  })
}

describe("dashboard", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path === "/api/evaluations?offset=0&limit=20") {
        return jsonResponse({
          items: [run],
          total: 1,
          completed: 1,
          failed: 0,
          offset: 0,
          limit: 20,
        })
      }
      if (path.endsWith("/quality-summary")) return jsonResponse(quality)
      if (path.endsWith("/security-summary")) return jsonResponse(security)
      if (path.endsWith("/performance-summary"))
        return jsonResponse(performance)
      if (path.endsWith("/cost-summary")) return jsonResponse(cost)
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  it("shows the newest completed run and compares only complete model metrics", async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole("heading", { name: "Knowledge set evaluation" }),
    ).toBeInTheDocument()
    expect((await screen.findAllByText("80.0")).length).toBeGreaterThan(0)
    expect(screen.getByText("exact 70.0% · 3 scored")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: /Models 2/ }))
    expect(
      screen.getByRole("img", { name: /Relative profile/ }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Model A" }))
    expect(screen.getByRole("button", { name: "Model A" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    const modelA = within(screen.getByRole("tabpanel")).getByRole("row", {
      name: /Model A/,
    })
    const modelB = within(screen.getByRole("tabpanel")).getByRole("row", {
      name: /Model B/,
    })
    expect(within(modelA).queryByLabelText("Best")).not.toBeInTheDocument()
    expect(within(modelB).queryByLabelText("Best")).not.toBeInTheDocument()
    expect(within(modelB).getAllByText("1 unavailable").length).toBeGreaterThan(
      0,
    )
    expect(
      fetchMock.mock.calls
        .map(([input]) => String(input))
        .filter((path) => path.includes("summary"))
        .every((path) => path.includes(RUN_ID)),
    ).toBe(true)

    await user.click(screen.getByRole("tab", { name: /Prompt versions 2/ }))
    expect(
      screen.getByRole("tabpanel", { name: /Prompt versions 2/ }),
    ).toBeInTheDocument()
    const promptOne = within(screen.getByRole("tabpanel")).getByRole("row", {
      name: /Knowledge prompt · v1/,
    })
    const promptTwo = within(screen.getByRole("tabpanel")).getByRole("row", {
      name: /Knowledge prompt · v2/,
    })
    expect(within(promptOne).queryByLabelText("Best")).not.toBeInTheDocument()
    expect(within(promptTwo).queryByLabelText("Best")).not.toBeInTheDocument()
    await user.keyboard("{ArrowLeft}")
    expect(screen.getByRole("tab", { name: /Models 2/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("explains unavailable security data and a run with only one prompt", async () => {
    const user = userEvent.setup()
    const noSecurity: EvaluationSecuritySummary = {
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
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path === "/api/evaluations?offset=0&limit=20") {
        return jsonResponse({
          items: [run],
          total: 1,
          completed: 1,
          failed: 0,
          offset: 0,
          limit: 20,
        })
      }
      if (path.endsWith("/quality-summary")) {
        return jsonResponse({
          metrics: quality.metrics.map((item) => ({
            ...item,
            by_prompt_version: item.by_prompt_version.slice(0, 1),
          })),
        })
      }
      if (path.endsWith("/security-summary")) return jsonResponse(noSecurity)
      if (path.endsWith("/performance-summary")) {
        return jsonResponse({
          ...performance,
          latency_by_prompt_version:
            performance.latency_by_prompt_version.slice(0, 1),
          token_usage_by_prompt_version:
            performance.token_usage_by_prompt_version.slice(0, 1),
        })
      }
      if (path.endsWith("/cost-summary")) {
        return jsonResponse({
          ...cost,
          by_prompt_version: cost.by_prompt_version.slice(0, 1),
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText("No security cases in dataset"),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: /Prompt versions 1/ }))
    expect(
      await screen.findByText(/only one prompt version/i),
    ).toBeInTheDocument()
  })
  it.each(["0.121109", null])("preserves headline cost precision and missing-data feedback for %s", async (estimatedUsd) => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input).endsWith("/cost-summary")
        ? jsonResponse({ ...cost, overall: { ...cost.overall, estimated_usd: estimatedUsd } })
        : original(input, init),
    )
    render(<MemoryRouter><App /></MemoryRouter>)
    await screen.findByText("exact 70.0% · 3 scored")
    const overview = within(screen.getByLabelText("Run overview"))
    const costCell = overview.getByText("Est. cost").parentElement!
    if (estimatedUsd === null) {
      expect(within(costCell).getByText("—", { exact: true })).toBeInTheDocument()
      expect(costCell).not.toHaveTextContent("$")
    } else {
      expect(costCell).toHaveTextContent("$0.121109")
    }
    expect(costCell).toHaveTextContent(`${cost.overall.priced_results} priced`)
    expect(costCell).toHaveTextContent(`${cost.overall.unavailable_results} unpriced`)
  })

  it("marks leaders only when the entire column is complete", async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/quality-summary"))
        return jsonResponse({
          metrics: quality.metrics.map((metric) => ({
            ...metric,
            by_model: metric.by_model.map((row) => ({
              ...row,
              unavailable_results: 0,
            })),
          })),
        })
      return original(input, init)
    })
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText("exact 70.0% · 3 scored")
    const panel = within(screen.getByRole("tabpanel"))
    expect(
      within(panel.getByRole("row", { name: /Model B/ })).getByLabelText(
        "Best",
      ),
    ).toHaveTextContent("▲")
    expect(
      within(panel.getByRole("row", { name: /Model A/ })).queryByLabelText(
        "Best",
      ),
    ).not.toBeInTheDocument()
  })

  it("switches the run with picker and recent links while retaining query parameters", async () => {
    const user = userEvent.setup()
    const other = { ...run, id: "older-run", dataset_name: "Older dataset" }
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input) === "/api/evaluations?offset=0&limit=20"
        ? jsonResponse({ items: [run, other], total: 2, offset: 0, limit: 20 })
        : original(input, init),
    )
    render(
      <MemoryRouter initialEntries={[`/?run=${RUN_ID}&keep=yes`]}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText("exact 70.0% · 3 scored")
    await user.selectOptions(
      screen.getAllByRole("combobox", { name: "Run" })[0],
      other.id,
    )
    await screen.findByRole("heading", { name: "Older dataset evaluation" })
    const recent = screen.getByRole("link", { name: /Knowledge set/ })
    expect(recent).toHaveAttribute("href", `/?run=${RUN_ID}&keep=yes`)
    await user.click(recent)
    await screen.findByRole("heading", { name: "Knowledge set evaluation" })
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("older-run/quality-summary"),
      ),
    ).toBe(true)
  })

  it("loads older runs into the picker and recent rail", async () => {
    const user = userEvent.setup()
    const older = { ...run, id: "older-run", dataset_name: "Older dataset" }
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === "/api/evaluations?offset=0&limit=20")
        return jsonResponse({ items: [run], total: 2, offset: 0, limit: 20 })
      if (String(input) === "/api/evaluations?offset=1&limit=20")
        return jsonResponse({ items: [older], total: 2, offset: 1, limit: 20 })
      return original(input, init)
    })
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole("button", { name: "Load 1 more" }))
    expect(
      await screen.findByRole("link", { name: /Older dataset/ }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole("option", { name: /Older dataset/ }),
    ).toHaveLength(2)
  })

  it("shows an active deep link without fetching summaries", async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input) === "/api/evaluations/active-run"
        ? jsonResponse({ ...run, id: "active-run", status: "running" })
        : original(input, init),
    )
    render(
      <MemoryRouter initialEntries={["/?run=active-run"]}>
        <App />
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole("link", { name: "View progress" }),
    ).toHaveAttribute("href", "/evaluations/active-run")
    expect(screen.getByRole("status")).toHaveTextContent(
      "This run is still running",
    )
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("summary")),
    ).toBe(false)
  })

  it("keeps loading feedback and retries a failed history request", async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValueOnce(new Error("History offline"))
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard")
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach FastAPI",
    )
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(
      await screen.findByRole("heading", { name: "Knowledge set evaluation" }),
    ).toBeInTheDocument()
  })

  it("keeps a page heading and creation action when there are no completed runs", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [], total: 0, offset: 0, limit: 20 }),
    )
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText("No completed evaluations yet"),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument()
    expect(
      screen
        .getAllByRole("link", { name: "New evaluation" })
        .some((link) => link.getAttribute("href") === "/evaluations/new"),
    ).toBe(true)
  })

  it("retries summary errors without losing the selected run", async () => {
    const user = userEvent.setup()
    const original = fetchMock.getMockImplementation()!
    let fail = true
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/quality-summary") && fail)
        return new Response(JSON.stringify({ detail: "Summary unavailable" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      return original(input, init)
    })
    render(
      <MemoryRouter initialEntries={[`/?run=${RUN_ID}`]}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Summary unavailable",
    )
    expect(
      screen.getByRole("heading", { name: "Knowledge set evaluation" }),
    ).toBeInTheDocument()
    expect(
      screen
        .getAllByRole("link", { name: "Open results" })
        .every(
          (link) => link.getAttribute("href") === `/evaluations/${RUN_ID}`,
        ),
    ).toBe(true)
    fail = false
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(
      await screen.findByText("exact 70.0% · 3 scored"),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Knowledge set evaluation" }),
    ).toBeInTheDocument()
  })

  it("ignores a stale summary after switching runs", async () => {
    const user = userEvent.setup()
    const other = { ...run, id: "older-run", dataset_name: "Older dataset" }
    const original = fetchMock.getMockImplementation()!
    let release: ((response: Response) => void) | undefined
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === "/api/evaluations?offset=0&limit=20")
        return jsonResponse({
          items: [run, other],
          total: 2,
          offset: 0,
          limit: 20,
        })
      if (path === `/api/evaluations/${RUN_ID}/quality-summary`)
        return new Promise<Response>((resolve) => {
          release = resolve
        })
      return original(input, init)
    })
    render(
      <MemoryRouter initialEntries={[`/?run=${RUN_ID}`]}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole("heading", { name: "Knowledge set evaluation" })
    await user.selectOptions(
      screen.getAllByRole("combobox", { name: "Run" })[0],
      other.id,
    )
    await screen.findByText("exact 70.0% · 3 scored")
    await act(async () => {
      release!(
        jsonResponse({
          metrics: quality.metrics.map((metric) => ({
            ...metric,
            overall: { ...metric.overall, average_score: 0.1 },
          })),
        }),
      )
    })
    expect(
      screen.getByRole("heading", { name: "Older dataset evaluation" }),
    ).toBeInTheDocument()
    expect(screen.queryByText("10.0")).not.toBeInTheDocument()
  })

  it("rounds headline latency and explains missing whole row aggregates", async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path.endsWith("/performance-summary"))
        return jsonResponse({
          ...performance,
          latency: { ...performance.latency, average_ms: 3757.5 },
          latency_by_model: [],
          token_usage_by_model: [],
        })
      if (path.endsWith("/cost-summary"))
        return jsonResponse({ ...cost, by_model: [] })
      if (path.endsWith("/security-summary"))
        return jsonResponse({ ...security, by_model: [] })
      return original(input, init)
    })
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByText("3,758")).toBeInTheDocument()
    const row = within(
      within(screen.getByRole("tabpanel")).getByRole("row", {
        name: /Model A/,
      }),
    )
    expect(row.getByText("Latency data unavailable")).toBeInTheDocument()
    expect(row.getByText("Token data unavailable")).toBeInTheDocument()
    expect(row.getByText("Cost data unavailable")).toBeInTheDocument()
    expect(row.getByText("Security data unavailable")).toBeInTheDocument()
    expect(row.getByText("Request status unavailable")).toBeInTheDocument()
    expect(row.queryByText("⚠ no price")).not.toBeInTheDocument()
    expect(row.queryByText("a", { exact: true })).not.toBeInTheDocument()
  })

  it("shows zero row failures only when the entire run has no failed requests", async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input) === "/api/evaluations?offset=0&limit=20"
        ? jsonResponse({
            items: [{ ...run, successful_requests: 4, failed_requests: 0 }],
            total: 1,
            offset: 0,
            limit: 20,
          })
        : original(input, init),
    )
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText("exact 70.0% · 3 scored")
    const row = within(
      within(screen.getByRole("tabpanel")).getByRole("row", {
        name: /Model B/,
      }),
    )
    expect(row.getByText("✕ 0")).toBeInTheDocument()
    expect(row.getByText("No failed requests")).toBeInTheDocument()
    expect(row.getAllByText("1 unavailable").length).toBeGreaterThan(0)
  })

  it("keeps switching runs after pagination fails and clears the previous summary", async () => {
    const user = userEvent.setup()
    const other = { ...run, id: "older-run", dataset_name: "Older dataset" }
    const original = fetchMock.getMockImplementation()!
    let release: ((response: Response) => void) | undefined
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === "/api/evaluations?offset=0&limit=20")
        return jsonResponse({
          items: [run, other],
          total: 3,
          offset: 0,
          limit: 20,
        })
      if (path === "/api/evaluations?offset=2&limit=20")
        return new Response(JSON.stringify({ detail: "Paging unavailable" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      if (path === "/api/evaluations/older-run/quality-summary")
        return new Promise<Response>((resolve) => {
          release = resolve
        })
      return original(input, init)
    })
    render(
      <MemoryRouter initialEntries={[`/?run=${RUN_ID}`]}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText("exact 70.0% · 3 scored")
    await user.click(screen.getByRole("button", { name: "Load 1 more" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Paging unavailable",
    )
    await user.selectOptions(
      screen.getAllByRole("combobox", { name: "Run" })[0],
      other.id,
    )
    await screen.findByRole("heading", { name: "Older dataset evaluation" })
    expect(screen.queryByText("80.0")).not.toBeInTheDocument()
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard")
    await act(async () => {
      release!(
        jsonResponse({
          metrics: quality.metrics.map((metric) => ({
            ...metric,
            overall: { ...metric.overall, average_score: 0.2 },
          })),
        }),
      )
    })
    expect(await screen.findByText("20.0")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Older dataset evaluation" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Paging unavailable")
  })

  it("explains an absent quality overview instead of claiming zero scored results", async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input).endsWith("/quality-summary")
        ? jsonResponse({ metrics: [] })
        : original(input, init),
    )
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole("tabpanel")
    const overview = screen.getByLabelText("Run overview")
    expect(within(overview).getByText("Quality data unavailable")).toBeInTheDocument()
    expect(within(overview).queryByText(/0 scored/)).not.toBeInTheDocument()
  })
})
