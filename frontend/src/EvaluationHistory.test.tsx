import { render, screen, within, waitFor } from "@testing-library/react"
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
      await within(await screen.findByTestId("runs-table")).findByRole("link", {
        name: "Knowledge set evaluation",
      }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("runs-table")).getByText("Model A"),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("runs-table")).getByText("Model B"),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("runs-table")).getByText("v2").closest("p"),
    ).toHaveTextContent("Knowledge prompt · v2")
    expect(
      within(screen.getByTestId("runs-cards")).getByRole("link", {
        name: "Open results",
      }),
    ).toHaveAttribute("href", `/evaluations/${run.id}`)
    expect(
      within(screen.getByTestId("runs-table")).getByRole("link", {
        name: "Compare",
      }),
    ).toHaveAttribute("href", `/?run=${run.id}`)
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

    expect(
      await within(await screen.findByTestId("runs-table")).findAllByText(
        /Unavailable for this historical run/,
      ),
    ).toHaveLength(2)
    expect(
      screen.queryByRole("link", { name: "Compare" }),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId("runs-cards")).getByRole("link", {
        name: "Open results",
      }),
    ).toBeInTheDocument()
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
        jsonResponse({
          items: [run],
          total: 2,
          completed: 2,
          failed: 0,
          offset: 0,
          limit: 20,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [older],
          total: 2,
          completed: 2,
          failed: 0,
          offset: 1,
          limit: 20,
        }),
      )
    render(
      <MemoryRouter initialEntries={["/evaluations/history"]}>
        <App />
      </MemoryRouter>,
    )

    await screen.findAllByRole("link", { name: "Knowledge set evaluation" })
    await user.click(screen.getByRole("button", { name: "Load 1 more" }))
    expect(
      (await screen.findAllByRole("link", { name: "Older set evaluation" }))[0],
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("runs-cards")).getByRole("link", {
        name: "Knowledge set evaluation",
      }),
    ).toBeInTheDocument()
  })

  it("shows a useful empty state", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [],
        total: 0,
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
    expect(
      await screen.findByRole("heading", { name: "No evaluations yet" }),
    ).toBeInTheDocument()
  })
  function showHistory() {
    return render(
      <MemoryRouter initialEntries={["/evaluations/history"]}>
        <App />
      </MemoryRouter>,
    )
  }

  it("uses API totals and includes pending runs in the keyboard-operated Running tab", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [{ ...run, status: "pending" }],
        total: 125,
        completed: 100,
        failed: 5,
        offset: 0,
        limit: 20,
      }),
    )
    showHistory()
    const all = await screen.findByRole("tab", { name: "All 125" })
    expect(
      screen.getByRole("tab", { name: "Completed 100" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Running 20" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Failed 5" })).toBeInTheDocument()
    all.focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Completed 100" })).toHaveFocus()
    expect(
      within(screen.getByTestId("runs-table")).getByRole("heading", {
        name: "No runs match",
      }),
    ).toBeInTheDocument()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "runs-running-tab",
    )
    expect(
      within(screen.getByTestId("runs-table")).getByText("Pending"),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 of 125 loaded/)).toBeInTheDocument()
    expect(
      screen.getByText(/Filters apply to this page only \(1 of 125 runs\)/),
    ).toHaveTextContent("Use Previous or Next to search another page.")
  })

  it("filters loaded runs by case-insensitive name, ID, dataset and model and clears no matches", async () => {
    const user = userEvent.setup()
    const other = {
      ...run,
      id: "other-run",
      dataset_id: "other-dataset",
      dataset_name: "Other set",
      models: [{ id: "c", name: "Model C" }],
    }
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [run, other],
        total: 2,
        completed: 2,
        failed: 0,
        offset: 0,
        limit: 20,
      }),
    )
    showHistory()
    const table = within(await screen.findByTestId("runs-table"))
    const search = screen.getByRole("searchbox", { name: "Search runs" })
    await user.type(search, "KNOWLEDGE")
    expect(
      table.getByRole("link", { name: "Knowledge set evaluation" }),
    ).toBeInTheDocument()
    expect(
      table.queryByRole("link", { name: "Other set evaluation" }),
    ).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, "other-run")
    expect(
      table.getByRole("link", { name: "Other set evaluation" }),
    ).toBeInTheDocument()
    await user.clear(search)
    await user.selectOptions(screen.getByLabelText("Dataset"), "other-dataset")
    expect(
      table.queryByRole("link", { name: "Knowledge set evaluation" }),
    ).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("Model"), "a")
    expect(
      table.getByRole("heading", { name: "No runs match" }),
    ).toBeInTheDocument()
    await user.click(table.getByRole("button", { name: "Clear filters" }))
    expect(table.getAllByRole("link", { name: /set evaluation/ })).toHaveLength(
      2,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("groups months and preserves repetition and request counts in the compact table", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          { ...run, repetitions: 3, id: run.id.toUpperCase() },
          {
            ...run,
            id: "september",
            created_at: "2026-09-20T10:00:00Z",
            status: "failed",
          },
        ],
        total: 2,
        completed: 1,
        failed: 1,
        offset: 0,
        limit: 20,
      }),
    )
    showHistory()
    const table = within(await screen.findByTestId("runs-table"))
    expect(table.getByRole("table", { name: "Saved runs" })).toBeInTheDocument()
    expect(
      table.getByRole("rowheader", { name: "August 2026" }),
    ).toBeInTheDocument()
    expect(
      table.getByRole("rowheader", { name: "September 2026" }),
    ).toBeInTheDocument()
    expect(table.getByText(/3 repetitions/)).toBeInTheDocument()
    expect(table.getByTitle(run.id.toUpperCase())).toHaveTextContent(
      run.id.slice(0, 8).toLowerCase(),
    )
    expect(table.getAllByLabelText("3 successful of 4 requests")).toHaveLength(
      2,
    )
    expect(table.getAllByText("✕ 1 failed")).toHaveLength(2)
    expect(table.getAllByRole("link", { name: "Compare" })).toHaveLength(2)
  })

  it("navigates desktop pages using offsets and cached Previous/Next while retaining mobile history", async () => {
    const user = userEvent.setup()
    const older = { ...run, id: "older", dataset_name: "Older set" }
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [run],
          total: 2,
          completed: 2,
          failed: 0,
          offset: 0,
          limit: 20,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [older],
          total: 2,
          completed: 2,
          failed: 0,
          offset: 1,
          limit: 20,
        }),
      )
    showHistory()
    const table = within(await screen.findByTestId("runs-table"))
    expect(table.getByRole("button", { name: "Previous" })).toBeDisabled()
    await user.click(table.getByRole("button", { name: "Next" }))
    expect(
      await table.findByRole("link", { name: "Older set evaluation" }),
    ).toBeInTheDocument()
    expect(
      table.queryByRole("link", { name: "Knowledge set evaluation" }),
    ).not.toBeInTheDocument()
    expect(table.getByText("2–2 of 2")).toBeInTheDocument()
    expect(
      screen.getByText(/Filters apply to this page only \(1 of 2 runs\)/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Filters apply to loaded results only \(2 of 2 loaded\)/,
      ),
    ).toBeInTheDocument()
    expect(table.getByRole("button", { name: "Next" })).toBeDisabled()
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/evaluations?offset=1&limit=20",
    )
    await user.click(table.getByRole("button", { name: "Previous" }))
    expect(
      table.getByRole("link", { name: "Knowledge set evaluation" }),
    ).toBeInTheDocument()
    await user.click(table.getByRole("button", { name: "Next" }))
    expect(
      table.getByRole("link", { name: "Older set evaluation" }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("runs-cards")).getAllByRole("link", {
        name: /set evaluation/,
      }),
    ).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("keeps snapshots after a pagination error and retries the failed offset", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [run],
          total: 2,
          completed: 2,
          failed: 0,
          offset: 0,
          limit: 20,
        }),
      )
      .mockRejectedValueOnce(new Error("History temporarily unavailable"))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ ...run, id: "older", dataset_name: "Older set" }],
          total: 2,
          completed: 2,
          failed: 0,
          offset: 1,
          limit: 20,
        }),
      )
    showHistory()
    await screen.findByTestId("runs-cards")
    await user.click(screen.getByRole("button", { name: "Load 1 more" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach FastAPI. Check that the backend is running.",
    )
    expect(
      within(screen.getByTestId("runs-cards")).getByRole("link", {
        name: "Knowledge set evaluation",
      }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(
      await within(screen.getByTestId("runs-cards")).findByRole("link", {
        name: "Older set evaluation",
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[2][0]).toBe(
      "/api/evaluations?offset=1&limit=20",
    )
  })

  it("retries a failed desktop Next and advances to the recovered page", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [run],
          total: 2,
          completed: 2,
          failed: 0,
          offset: 0,
          limit: 20,
        }),
      )
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ ...run, id: "recovered", dataset_name: "Recovered set" }],
          total: 2,
          completed: 2,
          failed: 0,
          offset: 1,
          limit: 20,
        }),
      )
    showHistory()
    const table = within(await screen.findByTestId("runs-table"))
    await user.click(table.getByRole("button", { name: "Next" }))
    await screen.findByRole("alert")
    expect(
      table.getByRole("link", { name: "Knowledge set evaluation" }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(
      await table.findByRole("link", { name: "Recovered set evaluation" }),
    ).toBeInTheDocument()
    expect(
      table.queryByRole("link", { name: "Knowledge set evaluation" }),
    ).not.toBeInTheDocument()
    expect(table.getByText("2–2 of 2")).toBeInTheDocument()
  })

  it("ignores stale pagination responses after the page unmounts", async () => {
    const user = userEvent.setup()
    let resolveOlder!: (response: Response) => void
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [run],
          total: 2,
          completed: 2,
          failed: 0,
          offset: 0,
          limit: 20,
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOlder = resolve
          }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [run],
          total: 1,
          completed: 1,
          failed: 0,
          offset: 0,
          limit: 20,
        }),
      )
    const old = showHistory()
    await screen.findByTestId("runs-table")
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
    old.unmount()
    showHistory()
    await screen.findByTestId("runs-table")
    resolveOlder(
      jsonResponse({
        items: [{ ...run, dataset_name: "Stale older set" }],
        total: 2,
        completed: 2,
        failed: 0,
        offset: 1,
        limit: 20,
      }),
    )
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "All 1" })).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole("link", { name: "Stale older set evaluation" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("offers initial error retry and ignores initial responses from an unmounted page", async () => {
    const user = userEvent.setup()
    let resolveOld!: (response: Response) => void
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockRejectedValueOnce(new Error("Could not connect"))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [run],
          total: 1,
          completed: 1,
          failed: 0,
          offset: 0,
          limit: 20,
        }),
      )
    const old = showHistory()
    expect(screen.getByRole("status")).toHaveTextContent("Loading history…")
    old.unmount()
    showHistory()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach FastAPI. Check that the backend is running.",
    )
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByTestId("runs-table")
    resolveOld(
      jsonResponse({
        items: [{ ...run, dataset_name: "Stale set" }],
        total: 1,
        completed: 1,
        failed: 0,
        offset: 0,
        limit: 20,
      }),
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(
      screen.queryByRole("link", { name: "Stale set evaluation" }),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId("runs-table")).getByRole("link", {
        name: "Knowledge set evaluation",
      }),
    ).toBeInTheDocument()
  })

  it("opens labelled mobile filters and restores focus when dismissed", async () => {
    const user = userEvent.setup()
    showHistory()
    await screen.findByTestId("runs-cards")
    const trigger = screen.getByRole("button", { name: "Filters" })
    await user.click(trigger)
    const dialog = within(screen.getByRole("dialog", { name: "Filter runs" }))
    expect(dialog.getByLabelText("Dataset")).toHaveFocus()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    await user.selectOptions(dialog.getByLabelText("Model"), "b")
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(
      within(screen.getByTestId("runs-cards")).getByText("Model B"),
    ).toBeInTheDocument()
  })
})
