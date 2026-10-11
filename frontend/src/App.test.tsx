import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import type { PromptDetail } from "@/api/prompts"

const CREATED_AT = "2026-08-22T10:00:00Z"
const PROMPT_ID = "21c71d8a-1dc7-4efe-9d4d-134c0b72fc2e"
const VERSION_ID = "87ad64a0-6206-4921-a102-92b75fc25188"

const prompt: PromptDetail = {
  id: PROMPT_ID,
  name: "Security prompt",
  description: "Checks instruction handling",
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  versions: [
    {
      id: VERSION_ID,
      prompt_id: PROMPT_ID,
      version_number: 1,
      system_prompt: null,
      content: "Answer safely.\n{{input}}",
      created_at: CREATED_AT,
    },
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe("prompt management", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("shows the empty prompt state and explains the input placeholder", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    renderApp("/prompts")

    expect(await screen.findByText("No prompts yet")).toBeInTheDocument()
    expect(screen.getByText(/It will be replaced with each test case input/)).toBeInTheDocument()
  })

  it("creates a prompt and navigates to its detail page", async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === "/api/prompts" && init?.method === "POST") {
        return jsonResponse(prompt, 201)
      }
      if (path === `/api/prompts/${PROMPT_ID}`) return jsonResponse(prompt)
      if (path === "/api/prompts") return jsonResponse([])
      throw new Error(`Unexpected request: ${path}`)
    })
    renderApp("/prompts")
    await screen.findByText("No prompts yet")

    await user.type(screen.getByLabelText("Name"), "Security prompt")
    await user.type(
      screen.getByLabelText(/Description/),
      "Checks instruction handling",
    )
    fireEvent.change(screen.getByLabelText("User prompt template"), {
      target: { value: "Answer safely.\n{{input}}" },
    })
    await user.click(screen.getByRole("button", { name: "Create prompt" }))

    expect(
      await screen.findByRole("heading", { name: "Security prompt", level: 1 }),
    ).toBeInTheDocument()
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: "Security prompt",
      description: "Checks instruction handling",
      system_prompt: null,
      content: "Answer safely.\n{{input}}",
    })
  })

  it("validates a prompt template before sending it", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    renderApp("/prompts")
    await screen.findByText("No prompts yet")

    await user.type(screen.getByLabelText("Name"), "Invalid template")
    fireEvent.change(screen.getByLabelText("User prompt template"), {
      target: { value: "This template has no input." },
    })
    await user.click(screen.getByRole("button", { name: "Create prompt" }))

    expect(screen.getByRole("alert")).toHaveTextContent("Include {{input}} exactly once")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("updates prompt metadata without creating a version", async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === `/api/prompts/${PROMPT_ID}` && init?.method === "PATCH") {
        return jsonResponse({ ...prompt, name: "Updated security prompt" })
      }
      if (path === `/api/prompts/${PROMPT_ID}`) return jsonResponse(prompt)
      throw new Error(`Unexpected request: ${path}`)
    })
    renderApp(`/prompts/${PROMPT_ID}`)
    await screen.findByRole("heading", { name: "Security prompt", level: 1 })

    const nameInput = screen.getByLabelText("Name")
    await user.clear(nameInput)
    await user.type(nameInput, "Updated security prompt")
    await user.click(screen.getByRole("button", { name: "Save details" }))

    expect(
      await screen.findByRole("heading", {
        name: "Updated security prompt",
        level: 1,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Prompt details saved.")
    expect(screen.getByText("1 version")).toBeInTheDocument()
  })

  it("creates an immutable version and renders model content as text", async () => {
    const user = userEvent.setup()
    const unsafeContent = '<img src="x" onerror="alert(1)">\n{{input}}'
    const originalSystem = "Original system instructions"
    const editedSystem = "Antworte freundlich.\n\nSprich die Kundschaft mit „du“ an."
    const originalPrompt = {
      ...prompt,
      versions: [{ ...prompt.versions[0], system_prompt: originalSystem }],
    }
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path.endsWith("/versions") && init?.method === "POST") {
        return jsonResponse(
          {
            id: "c84899a0-4956-464e-a364-ec93c7817bf3",
            prompt_id: PROMPT_ID,
            version_number: 2,
            system_prompt: editedSystem,
            content: unsafeContent,
            created_at: "2026-08-22T10:10:00Z",
          },
          201,
        )
      }
      if (path === `/api/prompts/${PROMPT_ID}`) return jsonResponse(originalPrompt)
      throw new Error(`Unexpected request: ${path}`)
    })
    const { container } = renderApp(`/prompts/${PROMPT_ID}`)
    await screen.findByRole("heading", { name: "Security prompt", level: 1 })

    expect(screen.getByLabelText(/System prompt/)).toHaveValue(originalSystem)
    expect(screen.getByLabelText("User prompt template")).toHaveValue(prompt.versions[0].content)
    fireEvent.change(screen.getByLabelText(/System prompt/), {
      target: { value: editedSystem },
    })
    fireEvent.change(screen.getByLabelText("User prompt template"), {
      target: { value: unsafeContent },
    })
    await user.click(screen.getByRole("button", { name: "Create version" }))

    expect(await screen.findByText("Version 2")).toBeInTheDocument()
    const versionCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith("/versions") && init?.method === "POST",
    )
    expect(JSON.parse(String(versionCall?.[1]?.body))).toEqual({
      content: unsafeContent,
      system_prompt: editedSystem,
    })
    expect([...container.querySelectorAll("pre")].map((element) => element.textContent))
      .toEqual([unsafeContent, editedSystem, prompt.versions[0].content, originalSystem])
    expect(
      [...container.querySelectorAll("pre")].some(
        (element) => element.textContent === unsafeContent,
      ),
    ).toBe(true)
    expect(container.querySelector("img")).toBeNull()
  })

  it("shows sanitized API errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Prompt service unavailable." }, 503))

    renderApp("/prompts")

    expect(await screen.findByRole("alert")).toHaveTextContent("Prompt service unavailable.")
    await waitFor(() => expect(screen.queryByText("Loading prompts…")).not.toBeInTheDocument())
  })
})
