import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Link, MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { download } from "@/lib/download"

vi.mock("@/lib/download", () => ({
  download: vi.fn().mockResolvedValue(undefined),
}))
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
  models: [
    {
      id: "1",
      provider: "ollama",
      name: "Local model",
      model_name: "local-model:latest",
    },
  ],
  prompt_versions: [
    {
      id: VERSION_ID,
      prompt_id: "21c71d8a-1dc7-4efe-9d4d-134c0b72fc2e",
      prompt_name: "Knowledge prompt",
      version_number: 1,
      content_preview: "Answer exactly: {{input}}",
      system_prompt_preview: null,
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
  latency_by_prompt_version: [
    {
      prompt_version_id: VERSION_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 1,
      average_ms: 120,
      minimum_ms: 120,
      maximum_ms: 120,
      recorded_results: 1,
      unavailable_results: 0,
    },
  ],
  input_tokens: {
    sum_tokens: null,
    recorded_results: 0,
    unavailable_results: 1,
  },
  output_tokens: { sum_tokens: 1, recorded_results: 1, unavailable_results: 0 },
  total_tokens: {
    sum_tokens: null,
    recorded_results: 0,
    unavailable_results: 1,
  },
  token_usage_by_model: [
    {
      model_id: "1",
      model_name: "Local model",
      input_tokens: {
        sum_tokens: null,
        recorded_results: 0,
        unavailable_results: 1,
      },
      output_tokens: {
        sum_tokens: 1,
        recorded_results: 1,
        unavailable_results: 0,
      },
      total_tokens: {
        sum_tokens: null,
        recorded_results: 0,
        unavailable_results: 1,
      },
    },
  ],
  token_usage_by_prompt_version: [
    {
      prompt_version_id: VERSION_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 1,
      input_tokens: {
        sum_tokens: null,
        recorded_results: 0,
        unavailable_results: 1,
      },
      output_tokens: {
        sum_tokens: 1,
        recorded_results: 1,
        unavailable_results: 0,
      },
      total_tokens: {
        sum_tokens: null,
        recorded_results: 0,
        unavailable_results: 1,
      },
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
  by_prompt_version: [
    {
      prompt_version_id: VERSION_ID,
      prompt_name: "Knowledge prompt",
      prompt_version_number: 1,
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
  test_category: null,
  case_type: "standard",
  security_test_type: null,
  security_metric_version: null,
  security_status: null,
  repetition: 1,
  max_output_tokens: 1024,
  system_prompt: null,
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
    vi.mocked(download).mockClear()
    vi.stubGlobal("fetch", fetchMock)
  })

  function serveCompleted(
    items: EvaluationResult[] = [result],
    total = items.length,
  ) {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path.includes("quality-summary")) return jsonResponse(qualitySummary)
      if (path.includes("security-summary"))
        return jsonResponse(securitySummary)
      if (path.includes("performance-summary"))
        return jsonResponse(performanceSummary)
      if (path.includes("cost-summary")) return jsonResponse(costSummary)
      if (path.includes("/results?"))
        return jsonResponse({
          items,
          total,
          unfiltered_total: total,
          offset: 0,
          limit: 50,
          filter_options: {
            models: [
              { id: "1", name: "Local model" },
              { id: "2", name: "Other model" },
            ],
            prompt_versions: [
              { id: VERSION_ID, name: "Knowledge prompt", version_number: 1 },
            ],
            categories: ["knowledge"],
            has_uncategorized_category: true,
          },
        })
      return jsonResponse({
        ...completedRun,
        total_requests: total,
        completed_requests: total,
      })
    })
  }

  it("preserves multi-value URL filters until the affected single select changes", async () => {
    const user = userEvent.setup()
    serveCompleted()
    renderApp(
      `/evaluations/${RUN_ID}?model_id=1&model_id=2&category=knowledge&category=other&uncategorized=true`,
    )
    await screen.findByRole("table", { name: "Results" })
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue(
      "__multiple__",
    )
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Outcome" }),
      "failed",
    )
    await waitFor(() =>
      expect(
        fetchMock.mock.calls
          .filter(([path]) => String(path).includes("/results?"))
          .at(-1)?.[0],
      ).toContain(
        "model_id=1&model_id=2&category=knowledge&category=other&uncategorized=true&outcome=failed",
      ),
    )
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Category" }),
      "uncategorized:",
    )
    await waitFor(() => {
      const path = String(
        fetchMock.mock.calls
          .filter(([url]) => String(url).includes("/results?"))
          .at(-1)?.[0],
      )
      expect(path).toContain("uncategorized=true")
      expect(path).not.toContain("category=")
      expect(path).toContain("model_id=1&model_id=2")
    })
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls
          .filter(([path]) => String(path).includes("/results?"))
          .at(-1)?.[0],
      ).toBe(`/api/evaluations/${RUN_ID}/results?offset=0&limit=50`),
    )
  })

  it("exports the current URL filters and links to the same run on the dashboard", async () => {
    const user = userEvent.setup()
    serveCompleted()
    renderApp(`/evaluations/${RUN_ID}?model_id=1&uncategorized=true`)
    await screen.findByRole("table", { name: "Results" })
    await user.click(screen.getByRole("button", { name: "Export JSON" }))
    await user.click(screen.getAllByRole("button", { name: "CSV" })[0])
    expect(download).toHaveBeenCalledWith(
      `/api/evaluations/${RUN_ID}/export?model_id=1&uncategorized=true&format=json`,
      "evaluation-results.json",
    )
    expect(download).toHaveBeenCalledWith(
      `/api/evaluations/${RUN_ID}/export?model_id=1&uncategorized=true&format=csv`,
      "evaluation-results.csv",
    )
    expect(
      screen.getByRole("link", { name: "Compare on dashboard" }),
    ).toHaveAttribute("href", `/?run=${RUN_ID}`)
  })

  it("uses keyboard disclosures for prompts and retains stored model, token ceiling and pricing details", async () => {
    const user = userEvent.setup()
    serveCompleted([
      {
        ...result,
        system_prompt: "Stored system instructions",
        pricing: {
          input_usd_per_million_tokens: "1.25",
          output_usd_per_million_tokens: "2.5",
          currency: "USD",
          source: "openrouter",
          effective_date: "2026-08-23",
          fetched_at: "2026-08-23T09:00:00Z",
          stale: true,
          source_url: "https://example.com/price",
        },
      },
    ])
    renderApp(`/evaluations/${RUN_ID}`)
    const table = within(await screen.findByRole("table", { name: "Results" }))
    const expand = table.getByRole("button", { name: /Result 1:/ })
    expand.focus()
    await user.keyboard("{Enter}")
    expect(expand).toHaveAttribute("aria-expanded", "true")
    expect(
      document.getElementById(expand.getAttribute("aria-controls")!),
    ).toHaveTextContent(result.expected_output)
    expect(table.getByText("1,024")).toBeInTheDocument()
    expect(
      table.getAllByText(result.reported_model_name!).length,
    ).toBeGreaterThan(0)
    expect(
      table.getByText(/OpenRouter price retrieved 2026-08-23T09:00:00Z/),
    ).toHaveTextContent("$1.25 input and $2.50 output per 1M tokens")
    expect(table.getByText(/stale price/)).toBeInTheDocument()
    expect(table.getByRole("link", { name: "source" })).toHaveAttribute(
      "href",
      "https://example.com/price",
    )
    const disclosure = table.getByRole("button", { name: /System prompt/ })
    expect(disclosure).toHaveAttribute("aria-expanded", "false")
    disclosure.focus()
    await user.keyboard(" ")
    expect(disclosure).toHaveAttribute("aria-expanded", "true")
    expect(
      document.getElementById(disclosure.getAttribute("aria-controls")!),
    ).toHaveTextContent("Stored system instructions")
    expand.focus()
    await user.keyboard("{Enter}")
    expect(expand).toHaveAttribute("aria-expanded", "false")
    expect(
      table.queryByText("Stored system instructions"),
    ).not.toBeInTheDocument()
  })

  it("opens the mobile filter dialog and restores focus on Escape", async () => {
    const user = userEvent.setup()
    serveCompleted()
    renderApp(`/evaluations/${RUN_ID}`)
    await screen.findByRole("table", { name: "Results" })
    const trigger = screen.getByRole("button", { name: "Filters" })
    await user.click(trigger)
    const dialog = screen.getByRole("dialog", { name: "Filter results" })
    expect(
      within(dialog).getByRole("combobox", { name: "Model" }),
    ).toHaveFocus()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("ignores a pagination response from filters that have since changed", async () => {
    const user = userEvent.setup()
    serveCompleted([result], 2)
    const completedFetch = fetchMock.getMockImplementation()!
    let resolvePage!: (response: Response) => void
    fetchMock.mockImplementation((input, init) =>
      String(input).includes("offset=1")
        ? new Promise<Response>((resolve) => {
            resolvePage = resolve
          })
        : completedFetch(input, init),
    )
    renderApp(`/evaluations/${RUN_ID}`)
    await screen.findByRole("table", { name: "Results" })
    expect(screen.getByText(/Loaded results only/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Load 1 more" }))
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Outcome" }),
      "passed",
    )
    await waitFor(() =>
      expect(
        fetchMock.mock.calls
          .filter(([path]) => String(path).includes("/results?"))
          .at(-1)?.[0],
      ).toContain("outcome=passed"),
    )
    resolvePage(
      jsonResponse({
        items: [{ ...result, id: "late", test_input: "Stale page content" }],
        total: 2,
        offset: 1,
        limit: 50,
      }),
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Load 1 more" })).toBeEnabled(),
    )
    expect(screen.queryByText("Stale page content")).not.toBeInTheDocument()
  })

  it("clears local search together with URL filters", async () => {
    const user = userEvent.setup()
    serveCompleted()
    renderApp(`/evaluations/${RUN_ID}`)
    await screen.findByRole("table", { name: "Results" })
    await user.type(
      screen.getByRole("searchbox", { name: "Search results" }),
      "not present",
    )
    expect(
      screen.getByText("No results match these filters"),
    ).toBeInTheDocument()
    await user.click(
      screen.getAllByRole("button", { name: "Clear filters" })[0],
    )
    expect(
      screen.getByRole("searchbox", { name: "Search results" }),
    ).toHaveValue("")
    expect(
      within(screen.getByRole("table", { name: "Results" })).getByText(
        result.test_input,
      ),
    ).toBeInTheDocument()
  })

  it("keeps a stored category named like the uncategorized sentinel selectable", async () => {
    const user = userEvent.setup()
    serveCompleted()
    const completedFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      const response = await completedFetch(input, init)
      if (!String(input).includes("/results?")) return response
      const page = await response.json()
      page.filter_options.categories.push("__uncategorized__")
      return jsonResponse(page)
    })
    renderApp(
      `/evaluations/${RUN_ID}?category=__uncategorized__&category=__uncategorized__`,
    )
    await screen.findByRole("table", { name: "Results" })
    const select = screen.getByRole("combobox", { name: "Category" })
    expect(
      within(select).getAllByRole("option", { name: "__uncategorized__" }),
    ).toHaveLength(1)
    await user.selectOptions(select, "category:__uncategorized__")
    await waitFor(() => {
      const path = String(
        fetchMock.mock.calls
          .filter(([url]) => String(url).includes("/results?"))
          .at(-1)?.[0],
      )
      expect(path).toContain("category=__uncategorized__")
      expect(path).not.toContain("uncategorized=true")
    })
  })

  it("resets a terminal run and its exports when navigating to a running run", async () => {
    const user = userEvent.setup()
    serveCompleted()
    const completedFetch = fetchMock.getMockImplementation()!
    const nextId = "next-run"
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (!path.includes(nextId)) return completedFetch(input, init)
      if (path.includes("/results?"))
        return jsonResponse({ items: [], total: 1, offset: 0, limit: 50 })
      return jsonResponse({
        ...completedRun,
        id: nextId,
        dataset_name: "Next dataset",
        status: "running",
        completed_requests: 0,
      })
    })
    render(
      <MemoryRouter initialEntries={[`/evaluations/${RUN_ID}`]}>
        <Link to={`/evaluations/${nextId}`}>Next run</Link>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole("heading", { name: "Knowledge set evaluation" })
    expect(
      screen.getByRole("button", { name: "Export JSON" }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("link", { name: "Next run" }))
    await screen.findByRole("heading", { name: "Next dataset evaluation" })
    expect(
      screen.queryByRole("button", { name: "Export JSON" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Summary details" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("100.0%")).not.toBeInTheDocument()
    expect(screen.queryByText(result.test_input)).not.toBeInTheDocument()
  })

  it("starts the latest validated configuration and opens its persistent run", async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/models") return jsonResponse([])
      if (url === "/api/evaluations/options") return jsonResponse(options)
      if (url === "/api/evaluations/preview") return jsonResponse(preview)
      if (url === "/api/evaluations" && init?.method === "POST") {
        return jsonResponse({ ...completedRun, status: "pending" }, 202)
      }
      if (url === `/api/evaluations/${RUN_ID}`) return jsonResponse(completedRun)
      if (url.startsWith(`/api/evaluations/${RUN_ID}/results?`)) {
        return jsonResponse({ items: [result], total: 1, offset: 0, limit: 50 })
      }
      if (url === `/api/evaluations/${RUN_ID}/quality-summary`) return jsonResponse(qualitySummary)
      if (url === `/api/evaluations/${RUN_ID}/security-summary`) return jsonResponse(securitySummary)
      if (url === `/api/evaluations/${RUN_ID}/performance-summary`) return jsonResponse(performanceSummary)
      if (url === `/api/evaluations/${RUN_ID}/cost-summary`) return jsonResponse(costSummary)
      throw new Error(`Unexpected request: ${url}`)
    })
    renderApp("/evaluations/new")

    await user.click(await screen.findByRole("checkbox", { name: /Knowledge prompt.*v1/ }))
    await user.click(screen.getByRole("radio", { name: /Knowledge set/ }))
    const startButton = screen.getByRole("button", { name: "Start evaluation" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    expect(
      await screen.findByRole("heading", { name: "Knowledge set evaluation" }),
    ).toBeInTheDocument()
    const startCalls = fetchMock.mock.calls.filter(([input, init]) =>
      String(input) === "/api/evaluations" && init?.method === "POST",
    )
    expect(startCalls).toHaveLength(1)
    const startCall = startCalls[0]
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

    const table = within(await screen.findByRole("table", { name: "Results" }))
    expect(table.getByText("● running")).toBeInTheDocument()
    await userEvent.click(table.getByRole("button", { name: /Result 1:/ }))
    expect(screen.getByText("1/3")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      String(1 / 3),
    )
    expect(
      table.getByText("Waiting for the model response…"),
    ).toBeInTheDocument()
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
        jsonResponse({
          ...completedRun,
          total_requests: 2,
          completed_requests: 2,
        }),
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

    const table = within(await screen.findByRole("table", { name: "Results" }))
    const expand = table.getByRole("button", { name: /Result 1:/ })
    expect(expand).toHaveAttribute("aria-expanded", "false")
    await user.click(expand)
    expect(expand).toHaveAttribute("aria-expanded", "true")
    expect(table.getByText(unsafe)).toBeInTheDocument()
    await user.click(table.getByRole("button", { name: /Rendered prompt/ }))
    await user.click(screen.getByRole("button", { name: "Summary details" }))
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    expect(
      table.getByText("Answer exactly: Capital of France?"),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole("heading", { name: "Normalized exact match" }),
    ).toHaveLength(1)
    expect(table.getByText("Normalized exact match v1")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Performance" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Estimated costs" }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Load 1 more" }))
    await waitFor(() => expect(table.getByText("2 + 2?")).toBeInTheDocument())
  })

  it("shows stored failure types, messages, and test-case identifiers", async () => {
    const invalidKey = {
      ...result,
      status: "failed" as const,
      generated_output: null,
      error_code: "invalid_api_key",
      error_message: "The provider rejected the API key (HTTP 401).",
      completed_at: "2026-08-23T10:00:02Z",
    }
    const historical = {
      ...invalidKey,
      id: "df9aefc8-e0c2-43c6-8776-b2b782f7aaf4",
      test_case_id: "a8c3b848-c3a3-4b22-8fa6-4bd4faa8d43e",
      test_input: "2 + 2?",
      error_code: "synthetic_provider_failure",
      error_message: "A historical provider failure was recorded.",
    }
    const missingType = {
      ...historical,
      id: "8c04351f-3c32-4778-aad6-0a8a960be7dc",
      error_code: null,
      error_message: "A failure without a historical type was recorded.",
    }
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ...completedRun,
          total_requests: 3,
          completed_requests: 3,
          successful_requests: 0,
          failed_requests: 3,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [invalidKey, historical, missingType],
          total: 3,
          offset: 0,
          limit: 50,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(qualitySummary))
      .mockResolvedValueOnce(jsonResponse(securitySummary))
      .mockResolvedValueOnce(jsonResponse(performanceSummary))
      .mockResolvedValueOnce(jsonResponse(costSummary))
    renderApp(`/evaluations/${RUN_ID}`)

    const table = within(await screen.findByRole("table", { name: "Results" }))
    for (const button of table.getAllByRole("button", { name: /Result / }))
      await userEvent.click(button)
    expect(table.getByText(/Invalid API key:/)).toBeInTheDocument()
    expect(table.getByText(/Synthetic Provider Failure:/)).toBeInTheDocument()
    expect(table.getByText(/Request failed:/)).toBeInTheDocument()
    expect(
      table.getByText("The provider rejected the API key (HTTP 401)."),
    ).toBeInTheDocument()
    expect(
      table.getByText("Test case ID: f0d638d3-3545-4890-be30-8f026fc967a2"),
    ).toBeInTheDocument()
    expect(
      table.getAllByText("Test case ID: a8c3b848-c3a3-4b22-8fa6-4bd4faa8d43e"),
    ).toHaveLength(2)
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

    const table = within(await screen.findByRole("table", { name: "Results" }))
    await userEvent.click(table.getByRole("button", { name: /Result 1:/ }))
    await userEvent.click(
      screen.getByRole("button", { name: "Summary details" }),
    )
    expect(
      screen.getByRole("heading", { name: "Security score" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText("1 passed · 1 failed · 1 unavailable · 3 total"),
    ).toBeInTheDocument()
    expect(table.getByText("Failure marker")).toBeInTheDocument()
    expect(table.getAllByText("✕ failed").length).toBeGreaterThan(0)
  })
})
