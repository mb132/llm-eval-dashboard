import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import type { DatasetDetail, TestCase } from "@/api/datasets"

const CREATED_AT = "2026-08-23T10:00:00Z"
const DATASET_ID = "1e9df267-fd16-46aa-bad8-82d91b4481fc"
const CASE_ID = "71949cc8-a0de-4c12-a5a4-c76e60c94774"

const firstCase: TestCase = {
  id: CASE_ID,
  dataset_id: DATASET_ID,
  input: "What is the capital of France?",
  expected_answer: "Paris",
  category: "general-knowledge",
  metadata: { difficulty: "easy", verified: true },
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
}

const dataset: DatasetDetail = {
  id: DATASET_ID,
  name: "General knowledge",
  description: "Small factual questions",
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  test_cases: [firstCase],
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

describe("dataset management", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("shows the empty state and creates a dataset with its first case", async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === "/api/datasets" && init?.method === "POST") {
        return jsonResponse(dataset, 201)
      }
      if (path === `/api/datasets/${DATASET_ID}`) return jsonResponse(dataset)
      if (path === "/api/datasets") return jsonResponse([])
      throw new Error(`Unexpected request: ${path}`)
    })

    renderApp("/datasets")
    expect(await screen.findByText("No datasets yet")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Name"), "General knowledge")
    await user.type(screen.getByLabelText(/Description/), "Small factual questions")
    await user.type(screen.getByLabelText("Input"), firstCase.input)
    await user.type(screen.getByLabelText("Expected answer"), firstCase.expected_answer)
    await user.type(screen.getByLabelText(/Category/), firstCase.category ?? "")
    await user.click(screen.getByRole("button", { name: "Add field" }))
    await user.type(screen.getByLabelText("Metadata key 1"), "difficulty")
    await user.type(screen.getByLabelText("Metadata value 1"), "easy")
    await user.click(screen.getByRole("button", { name: "Create dataset" }))

    expect(
      await screen.findByRole("heading", { name: "General knowledge", level: 1 }),
    ).toBeInTheDocument()
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: "General knowledge",
      description: "Small factual questions",
      test_case: {
        input: firstCase.input,
        expected_answer: firstCase.expected_answer,
        category: firstCase.category,
        metadata: { difficulty: "easy" },
      },
    })
  })

  it("validates required case fields before creating a dataset", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    renderApp("/datasets")
    await screen.findByText("No datasets yet")

    await user.type(screen.getByLabelText("Name"), "Incomplete")
    await user.click(screen.getByRole("button", { name: "Create dataset" }))

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Input and expected answer are required.",
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("renders untrusted case content and metadata as text", async () => {
    const unsafe = '<img src="x" onerror="alert(1)">'
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...dataset,
        test_cases: [
          { ...firstCase, input: unsafe, metadata: { payload: unsafe } },
        ],
      }),
    )
    const { container } = renderApp(`/datasets/${DATASET_ID}`)

    expect(await screen.findAllByText(unsafe)).toHaveLength(2)
    expect(container.querySelector("img")).toBeNull()
  })

  it("adds, edits, and deletes test cases with explicit confirmation", async () => {
    const user = userEvent.setup()
    const secondCase: TestCase = {
      ...firstCase,
      id: "96b492b2-bbe5-4567-98d6-59d9d89b89d1",
      input: "2 + 2?",
      expected_answer: "4",
      category: null,
      metadata: null,
    }
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === `/api/datasets/${DATASET_ID}/test-cases` && init?.method === "POST") {
        return jsonResponse(secondCase, 201)
      }
      if (path.endsWith(`/${secondCase.id}`) && init?.method === "PATCH") {
        return jsonResponse({ ...secondCase, expected_answer: "Four" })
      }
      if (path.endsWith(`/${secondCase.id}`) && init?.method === "DELETE") {
        return new Response(null, { status: 204 })
      }
      if (path === `/api/datasets/${DATASET_ID}`) return jsonResponse(dataset)
      throw new Error(`Unexpected request: ${path}`)
    })
    renderApp(`/datasets/${DATASET_ID}`)
    await screen.findByRole("heading", { name: "General knowledge", level: 1 })

    const addCard = screen
      .getByRole("heading", { name: "Add test case" })
      .closest('[data-slot="card"]')
    expect(addCard).not.toBeNull()
    await user.type(within(addCard as HTMLElement).getByLabelText("Input"), "2 + 2?")
    await user.type(within(addCard as HTMLElement).getByLabelText("Expected answer"), "4")
    await user.click(within(addCard as HTMLElement).getByRole("button", { name: "Add test case" }))
    expect(await screen.findByText("Test case added.")).toBeInTheDocument()
    expect(screen.getByText("2 cases")).toBeInTheDocument()

    const secondArticle = screen.getByText("2 + 2?").closest("article")
    expect(secondArticle).not.toBeNull()
    await user.click(within(secondArticle as HTMLElement).getByRole("button", { name: "Edit" }))
    const answer = within(secondArticle as HTMLElement).getByLabelText("Expected answer")
    fireEvent.change(answer, { target: { value: "Four" } })
    await user.click(
      within(secondArticle as HTMLElement).getByRole("button", { name: "Save test case" }),
    )
    expect(await screen.findByText("Test case saved.")).toBeInTheDocument()
    expect(within(secondArticle as HTMLElement).getByText("Four")).toBeInTheDocument()

    await user.click(within(secondArticle as HTMLElement).getByRole("button", { name: "Delete" }))
    expect(within(secondArticle as HTMLElement).getByText("Delete this case?")).toBeInTheDocument()
    await user.click(within(secondArticle as HTMLElement).getByRole("button", { name: "Confirm" }))
    expect(await screen.findByText("Test case deleted.")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText("2 + 2?")).not.toBeInTheDocument())
    expect(screen.getByText("1 case")).toBeInTheDocument()
  })

  it("keeps deletion unavailable for the last case", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(dataset))
    renderApp(`/datasets/${DATASET_ID}`)
    await screen.findByRole("heading", { name: "General knowledge", level: 1 })

    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled()
  })
})
