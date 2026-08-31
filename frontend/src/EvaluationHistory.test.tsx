import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import type { EvaluationRunHistory } from "@/api/evaluations"

const run: EvaluationRunHistory = {
  id: "fe90806e-cf08-4d63-9b60-cc47a46ee0ec",
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
  models: [
    { id: "a", name: "Model A" },
    { id: "b", name: "Model B" },
  ],
  prompt_versions: [
    {
      id: "87ad64a0-6206-4921-a102-92b75fc25188",
      name: "Knowledge prompt",
      version_number: 2,
    },
  ],
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  })
}

describe("evaluation history", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [run],
        total: 1,
        completed: 1,
        failed: 0,
        offset: 0,
        limit: 20,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
  })

  it("shows immutable configuration snapshots and reopens saved results", async () => {
    render(
      <MemoryRouter initialEntries={["/evaluations/history"]}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole("heading", { name: "Knowledge set evaluation" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Model A")).toBeInTheDocument()
    expect(screen.getByText("Model B")).toBeInTheDocument()
    expect(screen.getByText("Knowledge prompt · v2")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open results/ })).toHaveAttribute(
      "href",
      `/evaluations/${run.id}`,
    )
    expect(screen.getByRole("link", { name: "Compare models" })).toHaveAttribute(
      "href",
      `/?run=${run.id}`,
    )
  })
})
