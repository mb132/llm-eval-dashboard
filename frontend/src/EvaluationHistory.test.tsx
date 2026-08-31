import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

  it("handles active legacy runs without offering an invalid comparison", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          {
            ...run,
            status: "running",
            completed_at: null,
            completed_requests: 1,
            successful_requests: 1,
            failed_requests: 0,
            models: [],
            prompt_versions: [],
          },
        ],
        total: 1,
        completed: 0,
        failed: 0,
        offset: 0,
        limit: 20,
      }),
    )
    render(
      <MemoryRouter initialEntries={["/evaluations/history"]}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findAllByText(/Unavailable for this historical run/)).toHaveLength(2)
    expect(screen.queryByRole("link", { name: "Compare models" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open results/ })).toBeInTheDocument()
  })

  it("loads older runs without replacing newer history", async () => {
    const user = userEvent.setup()
    const older = {
      ...run,
      id: "9b60cc47-fe90-4806-bc47-a46ee0ec4956",
      dataset_name: "Older set",
      created_at: "2026-08-22T10:00:00Z",
    }
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ items: [run], total: 2, completed: 2, failed: 0, offset: 0, limit: 20 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [older], total: 2, completed: 2, failed: 0, offset: 1, limit: 20 }),
      )
    render(
      <MemoryRouter initialEntries={["/evaluations/history"]}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole("heading", { name: "Knowledge set evaluation" })
    await user.click(screen.getByRole("button", { name: "Load older evaluations" }))
    expect(
      await screen.findByRole("heading", { name: "Older set evaluation" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Knowledge set evaluation" })).toBeInTheDocument()
  })

  it("shows a useful empty state", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [], total: 0, completed: 0, failed: 0, offset: 0, limit: 20 }),
    )
    render(
      <MemoryRouter initialEntries={["/evaluations/history"]}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole("heading", { name: "No evaluations yet" })).toBeInTheDocument()
  })
})
