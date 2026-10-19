import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Link, MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PromptDetail, PromptSummary } from "@/api/prompts"
import { PromptDetailPage } from "@/pages/PromptDetailPage"
import { PromptsPage } from "@/pages/PromptsPage"

const timestamp = "2026-08-22T10:00:00Z"
const prompt: PromptDetail = {
  id: "first", name: "Safety prompt", description: "Original description",
  created_at: timestamp, updated_at: timestamp,
  // Deliberately unsorted, with a gap: the latest number is not the count.
  versions: [1, 4, 2].map((number) => ({
    id: `version-${number}`, prompt_id: "first", version_number: number,
    content: `Version ${number} user {{input}}`, system_prompt: `Version ${number} system`,
    created_at: `2026-08-22T10:0${number}:00Z`,
  })),
}
const second: PromptDetail = {
  ...prompt, id: "second", name: "Current prompt",
  versions: [{ ...prompt.versions[0], id: "second-version", prompt_id: "second", content: "Current {{input}}" }],
}

function summary(item: PromptDetail): PromptSummary {
  return {
    id: item.id, name: item.name, description: item.description,
    created_at: item.created_at, updated_at: item.updated_at,
    latest_version_number: Math.max(...item.versions.map((version) => version.version_number)),
  }
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
function deferred() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((complete) => { resolve = complete })
  return { promise, resolve }
}
function show(path = "/prompts/first") {
  return render(<MemoryRouter initialEntries={[path]}>
    <nav aria-label="Test destinations"><Link to="/prompts/second">Other prompt</Link><Link to="/away">Leave prompts</Link></nav>
    <Routes>
      <Route path="/prompts" element={<PromptsPage />} />
      <Route path="/prompts/:promptId" element={<PromptDetailPage />} />
      <Route path="/missing-id" element={<PromptDetailPage />} />
      <Route path="/away" element={<h1>Another page</h1>} />
    </Routes>
  </MemoryRouter>)
}
const fetchMock = vi.fn<typeof fetch>()
const textbox = (name: string) => screen.getByRole("textbox", { name: new RegExp(`^${name}( Optional)?$`) })
const change = (name: string, value: string) => fireEvent.change(textbox(name), { target: { value } })
const mutations = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "PATCH")
async function loaded() {
  await screen.findByRole("heading", { name: prompt.name, level: 1 })
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    if (String(input) === "/api/prompts") return response([summary(prompt)])
    if (String(input) === "/api/prompts/first") return response(prompt)
    if (String(input) === "/api/prompts/second") return response(second)
    throw new Error(`Unexpected request: ${String(input)}`)
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("prompt redesign regression coverage", () => {
  it("announces live count and placeholder errors and never submits an invalid new prompt", async () => {
    fetchMock.mockResolvedValue(response([]))
    show("/prompts")
    await screen.findByText("No prompts yet")
    const create = screen.getByRole("button", { name: "Create prompt" })
    const template = textbox("User template")
    expect(screen.getByRole("status")).toHaveTextContent("Add {{input}}")
    expect(template).toHaveAttribute("aria-describedby", expect.stringContaining("prompt-validation"))
    change("User template", "Valid {{input}}")
    expect(screen.getByRole("status")).toHaveTextContent("✓ {{input}} appears once")
    expect(create).toBeDisabled()
    change("Name", "  New prompt  ")
    expect(create).toBeEnabled()
    for (const content of ["No placeholder", "{{input}} {{input}}", "{{input}} {{other}}"]) {
      change("User template", content)
      if (content === "{{input}} {{input}}") {
        expect(screen.getByRole("status")).toHaveTextContent("✕ {{input}} appears 2 times. Use it once.")
      }
      expect(template).toHaveAttribute("aria-invalid", "true")
      expect(create).toBeDisabled()
      fireEvent.submit(create.closest("form")!)
    }
    expect(screen.getByRole("status")).toHaveTextContent("✕ Include {{input}} exactly once")
    change("User template", "Valid {{input}}")
    expect(template).toHaveAttribute("aria-invalid", "false")
    change("System prompt", "Invalid {{input}}")
    expect(textbox("System prompt")).toHaveAttribute("aria-invalid", "true")
    expect(textbox("System prompt")).toHaveAccessibleDescription("System prompt must not contain placeholders.")
    expect(create).toBeDisabled()
    fireEvent.submit(create.closest("form")!)
    expect(mutations()).toHaveLength(0)
    change("System prompt", "Valid system")
    expect(create).toBeEnabled()
    change("Name", "   ")
    expect(create).toBeDisabled()
  })

  it("searches older user and system templates case-insensitively and counts actual versions", async () => {
    show("/prompts")
    await screen.findByText("1 prompt · 3 versions")
    const search = screen.getByRole("searchbox", { name: "Search prompts" })
    for (const phrase of ["VERSION 1 USER", "version 2 SYSTEM"]) {
      fireEvent.change(search, { target: { value: phrase } })
      const table = screen.getByRole("table", { name: "Saved prompts" })
      expect(within(table).getByRole("link", { name: prompt.name })).toHaveAttribute("href", "/prompts/first")
      expect(within(table).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/prompts/first")
      expect(within(table).getByRole("link", { name: "Evaluate" })).toHaveAttribute("href", "/evaluations/new")
      expect(within(table).getByText("v4")).toBeInTheDocument()
    }
  })

  it("uses singular version copy for a prompt with one immutable version", async () => {
    fetchMock.mockImplementation(async (input) => response(String(input) === "/api/prompts" ? [summary(second)] : second))
    show("/prompts")
    expect(await screen.findByText("1 prompt · 1 version")).toBeInTheDocument()
  })

  it("keeps name search usable while history is pending and retries incomplete content search", async () => {
    const history = deferred()
    fetchMock.mockResolvedValueOnce(response([summary(prompt)])).mockReturnValueOnce(history.promise)
    show("/prompts")
    const search = screen.getByRole("searchbox", { name: "Search prompts" })
    await screen.findByRole("table")
    fireEvent.change(search, { target: { value: "SAFETY" } })
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(screen.getByText("1 prompt · versions pending")).toBeInTheDocument()
    fireEvent.change(search, { target: { value: "VERSION 1 USER" } })
    expect(screen.getByText("No matches in loaded prompts yet")).toBeInTheDocument()
    await act(async () => history.resolve(response({ detail: "History unavailable" }, 503)))
    expect(await screen.findByRole("alert")).toHaveTextContent("Template search and version count are incomplete")
    expect(screen.queryByText("No prompts match this search")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByText("1 prompt · 3 versions")
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("retries a list failure and focuses Name from the empty-state action", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(response({ detail: "List unavailable" }, 503)).mockResolvedValueOnce(response([]))
    show("/prompts")
    expect(await screen.findByRole("alert")).toHaveTextContent("List unavailable")
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await user.click(await screen.findByRole("button", { name: "Create first prompt" }))
    expect(textbox("Name")).toHaveFocus()
  })

  it("sorts unsorted history, selects read-only versions by keyboard, and resets both latest drafts", async () => {
    const user = userEvent.setup()
    show()
    await loaded()
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["v4 latest", "v2", "v1"])
    const create = screen.getByRole("button", { name: "Create version 5" })
    expect(create).toBeDisabled()
    const latest = screen.getByRole("tab", { name: "v4 latest" })
    latest.focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "v2" })).toHaveFocus()
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Version 2 user")
    expect(within(screen.getByRole("tabpanel")).queryByRole("textbox")).not.toBeInTheDocument()
    expect(textbox("User template")).toHaveValue("Version 4 user {{input}}")
    change("User template", "Draft {{input}} {{other}}")
    expect(create).toBeDisabled()
    change("User template", "Draft {{input}}")
    change("System prompt", "Draft system")
    expect(create).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "Reset to v4" }))
    expect(textbox("User template")).toHaveValue("Version 4 user {{input}}")
    expect(textbox("System prompt")).toHaveValue("Version 4 system")
    expect(create).toBeDisabled()
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Version 2 user")
  })

  it("uses a labelled native selector for long history and retains every creation timestamp", async () => {
    const history = { ...prompt, versions: Array.from({ length: 7 }, (_, index) => ({
      ...prompt.versions[0], id: `long-${index}`, version_number: index + 1,
      created_at: `2026-08-22T11:0${index}:00Z`, content: `History ${index} {{input}}`,
    })) }
    fetchMock.mockResolvedValue(response(history))
    const { container } = show()
    await loaded()
    const select = screen.getByRole("combobox", { name: "Version" })
    expect(select.tagName).toBe("SELECT")
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(within(select).getAllByRole("option")).toHaveLength(7)
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent("v7 · latest")
    for (const version of history.versions) {
      fireEvent.change(select, { target: { value: version.id } })
      expect(screen.getByRole("region", { name: "User template" })).toHaveTextContent(version.content)
      expect(Array.from(container.querySelectorAll("time")).some((time) => time.dateTime === version.created_at)).toBe(true)
    }
    expect(textbox("User template")).toHaveValue("History 6 {{input}}")
  })

  it("gates metadata edits and preserves an unsaved version draft after a metadata-only save", async () => {
    fetchMock.mockImplementation(async (_input, init) => response(init?.method === "PATCH" ? { ...prompt, name: "Renamed", description: null } : prompt))
    show()
    await loaded()
    const save = screen.getByRole("button", { name: "Save details" })
    expect(save).toBeDisabled()
    change("Name", "   ")
    expect(save).toBeDisabled()
    fireEvent.submit(save.closest("form")!)
    expect(mutations()).toHaveLength(0)
    change("Name", "  Renamed  ")
    change("Description", "   ")
    change("User template", "Unsaved {{input}}")
    change("System prompt", "Unsaved system")
    fireEvent.click(save)
    await screen.findByText("Prompt details saved.")
    expect(JSON.parse(String(mutations()[0][1]?.body))).toEqual({ name: "Renamed", description: null })
    expect(mutations()).toHaveLength(1)
    expect(textbox("User template")).toHaveValue("Unsaved {{input}}")
    expect(textbox("System prompt")).toHaveValue("Unsaved system")
    expect(screen.getByRole("button", { name: "Create version 5" })).toBeEnabled()
    expect(save).toBeDisabled()
  })

  it.each(["metadata", "version"] as const)("locks both forms during %s save, prevents duplicates, and preserves failed drafts for retry", async (kind) => {
    const pending = deferred()
    let attempts = 0
    fetchMock.mockImplementation(async (_input, init) => {
      if (!init?.method) return response(prompt)
      if (++attempts === 1) return pending.promise
      return response(kind === "metadata" ? { ...prompt, name: "Renamed" } : { ...prompt.versions[1], id: "new", version_number: 5, content: "Draft {{input}}", system_prompt: "Draft system" })
    })
    show()
    await loaded()
    change("Name", "Renamed")
    change("User template", "Draft {{input}}")
    change("System prompt", "Draft system")
    const save = screen.getByRole("button", { name: kind === "metadata" ? "Save details" : "Create version 5" })
    const form = save.closest("form")!
    fireEvent.submit(form)
    fireEvent.submit(form)
    for (const field of screen.getAllByRole("textbox")) expect(field).toBeDisabled()
    expect(screen.getByRole("button", { name: "Reset to v4" })).toBeDisabled()
    expect(mutations()).toHaveLength(1)
    await act(async () => pending.resolve(response({ detail: "Save unavailable" }, 503)))
    expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable")
    expect(textbox("Name")).toHaveValue("Renamed")
    expect(textbox("User template")).toHaveValue("Draft {{input}}")
    expect(textbox("System prompt")).toHaveValue("Draft system")
    fireEvent.submit(form)
    await screen.findByText(kind === "metadata" ? "Prompt details saved." : "Version 5 created.")
    expect(mutations()).toHaveLength(2)
  })

  it.each([
    ["metadata", 200, "other"], ["metadata", 503, "away"],
    ["version", 200, "away"], ["version", 503, "other"],
  ] as const)("ignores a pending %s response (%i) after navigating %s", async (kind, status, destination) => {
    const pending = deferred()
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method) return pending.promise
      return response(String(input).endsWith("/second") ? second : prompt)
    })
    show()
    await loaded()
    change("Name", "Renamed")
    change("User template", "Draft {{input}}")
    fireEvent.click(screen.getByRole("button", { name: kind === "metadata" ? "Save details" : "Create version 5" }))
    fireEvent.click(screen.getByRole("link", { name: destination === "other" ? "Other prompt" : "Leave prompts" }))
    const title = destination === "other" ? second.name : "Another page"
    await screen.findByRole("heading", { name: title, level: 1 })
    await act(async () => pending.resolve(response(status === 503 ? { detail: "Old save failed" } : kind === "metadata" ? { ...prompt, name: "Old response" } : { ...prompt.versions[1], version_number: 5 }, status)))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText(/Prompt details saved\.|Version 5 created\./)).not.toBeInTheDocument()
    if (destination === "other") {
      expect(textbox("Name")).toHaveValue(second.name)
      expect(textbox("User template")).toHaveValue("Current {{input}}")
      expect(screen.getByRole("button", { name: "Create version 2" })).toBeDisabled()
    }
  })

  it("ignores a delayed detail load after promptId changes", async () => {
    const pending = deferred()
    fetchMock.mockImplementation(async (input) => String(input).endsWith("/first") ? pending.promise : response(second))
    show()
    expect(screen.getByRole("status")).toHaveTextContent("Loading prompt")
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    fireEvent.click(screen.getByRole("link", { name: "Other prompt" }))
    await screen.findByRole("heading", { name: second.name, level: 1 })
    await act(async () => pending.resolve(response(prompt)))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(second.name)
    expect(textbox("User template")).toHaveValue("Current {{input}}")
  })

  it("shows missing-id recovery with one title and a functioning back link", async () => {
    show("/missing-id")
    expect(await screen.findByRole("alert")).toHaveTextContent("Prompt not found.")
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Prompt not found")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled()
    fireEvent.click(screen.getByRole("link", { name: "Back to prompts" }))
    await screen.findByRole("table")
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Prompts")
  })

  it("recovers a general detail error with Retry without duplicate page titles", async () => {
    fetchMock.mockResolvedValueOnce(response({ detail: "Detail unavailable" }, 503))
    show()
    expect(await screen.findByRole("alert")).toHaveTextContent("Detail unavailable")
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(screen.getByRole("link", { name: "Back to prompts" })).toHaveAttribute("href", "/prompts")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await loaded()
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })
})
