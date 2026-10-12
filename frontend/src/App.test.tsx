import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import type { PromptDetail } from "@/api/prompts"
import { AppShell } from "@/components/layout/app-shell"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"

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
    fireEvent.change(screen.getByRole("textbox", { name: "User template" }), {
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
    fireEvent.change(screen.getByRole("textbox", { name: "User template" }), {
      target: { value: "This template has no input." },
    })
    await user.click(screen.getByRole("button", { name: "Create prompt" }))

    expect(screen.getByRole("button", { name: "Create prompt" })).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent("Add {{input}} where each test case input goes.")
    expect(screen.getByRole("textbox", { name: "User template" })).toHaveAttribute("aria-invalid", "true")
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
    expect(await screen.findByText("Prompt details saved.")).toHaveAttribute("role", "status")
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

    expect(screen.getByRole("textbox", { name: /System prompt/ })).toHaveValue(originalSystem)
    expect(screen.getByRole("textbox", { name: "User template" })).toHaveValue(prompt.versions[0].content)
    fireEvent.change(screen.getByRole("textbox", { name: /System prompt/ }), {
      target: { value: editedSystem },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "User template" }), {
      target: { value: unsafeContent },
    })
    await user.click(screen.getByRole("button", { name: "Create version 2" }))

    expect(await screen.findByText("Version 2 created.")).toHaveAttribute("role", "status")
    expect(screen.getByRole("tab", { name: "v2 latest" })).toHaveAttribute("aria-selected", "true")
    const versionCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith("/versions") && init?.method === "POST",
    )
    expect(JSON.parse(String(versionCall?.[1]?.body))).toEqual({
      content: unsafeContent,
      system_prompt: editedSystem,
    })
    expect(screen.getByRole("region", { name: "User template" }).textContent).toBe(`User template${unsafeContent}`)
    expect(screen.getByRole("region", { name: "System prompt" }).textContent).toBe(`System prompt${editedSystem}`)
    expect(container.querySelector("img")).toBeNull()
    await user.click(screen.getByRole("tab", { name: "v1" }))
    expect(screen.getByRole("region", { name: "User template" }).textContent).toBe(`User template${prompt.versions[0].content}`)
    expect(screen.getByRole("region", { name: "System prompt" }).textContent).toBe(`System prompt${originalSystem}`)
  })

  it("shows sanitized API errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Prompt service unavailable." }, 503))

    renderApp("/prompts")

    expect(await screen.findByRole("alert")).toHaveTextContent("Prompt service unavailable.")
    await waitFor(() => expect(screen.queryByText("Loading prompts…")).not.toBeInTheDocument())
  })
})

describe("app shell", () => {
  function renderShell(path = "/", content = <p>Page content</p>) {
    return render(<MemoryRouter initialEntries={[path]}><AppShell>{content}</AppShell></MemoryRouter>)
  }

  it("groups navigation and marks Runs current for a detail route", () => {
    renderShell("/evaluations/12345678-abcd?filter=failed")
    const navigation = screen.getByRole("navigation", { name: "Primary" })
    expect(within(navigation).getByText("Analyze")).toBeInTheDocument()
    expect(within(navigation).getByText("Library")).toBeInTheDocument()
    expect(within(navigation).getByRole("link", { name: "Runs" })).toHaveAttribute("aria-current", "page")
    expect(within(navigation).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current")
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("12345678")).toHaveAttribute("title", "12345678-abcd")
    expect(screen.getByRole("link", { name: "New" })).toHaveAttribute("href", "/evaluations/new")
    expect(screen.getAllByRole("main")).toHaveLength(1)
  })

  it("marks New evaluation current without marking Runs current", () => {
    renderShell("/evaluations/new?dataset=dataset-id")
    const navigation = screen.getByRole("navigation", { name: "Primary" })
    expect(within(navigation).getByRole("link", { name: "Runs" })).not.toHaveAttribute("aria-current")
    expect(within(navigation).getByRole("link", { name: "New evaluation" })).toHaveAttribute("aria-current", "page")
  })

  it("allows pages to supply chrome without another main or top bar", () => {
    renderShell("/prompts/prompt-id", <PageFrame breadcrumbs={[{ label: "Prompts", to: "/prompts" }, { label: "Named prompt" }]} actions={<button>Evaluate this prompt</button>} mobileTitle="Prompts" mobileBack={{ label: "Prompts", to: "/prompts" }}>
      <PageHeader title="Named prompt" description="Immutable versions" metadata="Latest v2" />
    </PageFrame>)
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Named prompt")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Evaluate this prompt" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Named prompt")
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(screen.getAllByRole("navigation", { name: "Breadcrumb" })).toHaveLength(1)
  })

  it("shares and persists the theme across desktop and mobile controls", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: "Dark" }))
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }))
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    expect(localStorage.getItem("llm-eval-theme")).toBe("light")
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true")
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }))
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
  })

  it("traps drawer focus, locks scrolling, and restores focus on Escape", async () => {
    const user = userEvent.setup()
    renderShell()
    const trigger = screen.getByRole("button", { name: "Open navigation" })
    const previousOverflow = document.body.style.overflow
    await user.click(trigger)
    const drawer = screen.getByRole("dialog", { name: "Navigation" })
    const close = within(drawer).getByRole("button", { name: "Close navigation" })
    const last = within(drawer).getByRole("link", { name: "New evaluation" })
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(drawer).toHaveAttribute("aria-modal", "true")
    expect(close).toHaveFocus()
    expect(document.body.style.overflow).toBe("hidden")
    await user.tab({ shift: true })
    expect(last).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    trigger.focus()
    expect(close).toHaveFocus()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(document.body.style.overflow).toBe(previousOverflow)
  })

  it("closes on backdrop and navigation, preserving destination links", async () => {
    const user = userEvent.setup()
    renderShell()
    const trigger = screen.getByRole("button", { name: "Open navigation" })
    await user.click(trigger)
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Prompts" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "Prompts" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "New" })).toHaveAttribute("href", "/prompts#create-prompt")
  })

  it("offers the correct mobile New destination only on supported list pages", () => {
    const { unmount } = renderShell("/datasets")
    expect(screen.getByRole("link", { name: "New" })).toHaveAttribute("href", "/datasets#create-dataset")
    unmount()
    renderShell("/playground")
    expect(screen.queryByRole("link", { name: "New" })).not.toBeInTheDocument()
  })

  it("retains fallback mobile actions when PageFrame leaves them unspecified", () => {
    renderShell("/prompts", <PageFrame breadcrumbs={[{ label: "Prompts" }]}><PageHeader title="Prompts" /></PageFrame>)
    expect(screen.getByRole("link", { name: "New" })).toHaveAttribute("href", "/prompts#create-prompt")
  })
})
