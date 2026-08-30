import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import type { EvaluationOptions, EvaluationPreview } from "@/api/evaluations"

const DATASET_ID = "1e9df267-fd16-46aa-bad8-82d91b4481fc"
const VERSION_ONE_ID = "87ad64a0-6206-4921-a102-92b75fc25188"
const VERSION_TWO_ID = "c84899a0-4956-464e-a364-ec93c7817bf3"

const options: EvaluationOptions = {
  models: [
    { id: "model-a", provider: "ollama", name: "Model A", model_name: "model-a:latest" },
    { id: "model-b", provider: "ollama", name: "Model B", model_name: "model-b:latest" },
  ],
  prompt_versions: [
    {
      id: VERSION_TWO_ID,
      prompt_id: "21c71d8a-1dc7-4efe-9d4d-134c0b72fc2e",
      prompt_name: "General knowledge",
      version_number: 2,
      content_preview: "Answer clearly. {{input}}",
    },
    {
      id: VERSION_ONE_ID,
      prompt_id: "21c71d8a-1dc7-4efe-9d4d-134c0b72fc2e",
      prompt_name: "General knowledge",
      version_number: 1,
      content_preview: "Answer accurately. {{input}}",
    },
  ],
  datasets: [
    { id: DATASET_ID, name: "Knowledge set", test_case_count: 2 },
  ],
}

const preview: EvaluationPreview = {
  model_ids: ["model-a", "model-b"],
  prompt_version_ids: [VERSION_TWO_ID, VERSION_ONE_ID],
  dataset_id: DATASET_ID,
  repetitions: 2,
  model_count: 2,
  prompt_version_count: 2,
  test_case_count: 2,
  combination_count: 4,
  total_requests: 16,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const emptyArchive = {
  items: [],
  total: 0,
  completed: 0,
  failed: 0,
  offset: 0,
  limit: 20,
}

function renderEvaluation() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  )
}

describe("evaluation configuration", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(emptyArchive)))
    vi.stubGlobal("fetch", fetchMock)
  })

  it("previews multiple models and prompt versions with the exact request", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(options))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [],
          total: 0,
          completed: 0,
          failed: 0,
          offset: 0,
          limit: 20,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(preview))
    renderEvaluation()

    expect(
      await screen.findByRole("heading", { name: "Configure evaluation" }),
    ).toBeInTheDocument()
    const reviewButton = screen.getByRole("button", {
      name: "Review configuration",
    })
    expect(reviewButton).toBeDisabled()

    await user.click(screen.getByRole("checkbox", { name: /Model A/ }))
    await user.click(screen.getByRole("checkbox", { name: /Model B/ }))
    await user.click(screen.getByRole("checkbox", { name: /Version 2/ }))
    await user.click(screen.getByRole("checkbox", { name: /Version 1/ }))
    await user.click(screen.getByRole("radio", { name: /Knowledge set/ }))
    const repetitions = screen.getByLabelText("Repetitions")
    await user.clear(repetitions)
    await user.type(repetitions, "2")
    await user.click(reviewButton)

    expect(
      await screen.findByRole("heading", { name: "Configuration valid" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Total model requests").nextSibling).toHaveTextContent(
      "16",
    )
    const previewCall = fetchMock.mock.calls[2]
    expect(String(previewCall[0])).toBe("/api/evaluations/preview")
    expect(JSON.parse(String(previewCall[1]?.body))).toEqual({
      model_ids: ["model-a", "model-b"],
      prompt_version_ids: [VERSION_TWO_ID, VERSION_ONE_ID],
      dataset_id: DATASET_ID,
      repetitions: 2,
    })

    await user.click(screen.getByRole("checkbox", { name: /Model B/ }))
    expect(
      screen.queryByRole("heading", { name: "Configuration valid" }),
    ).not.toBeInTheDocument()
  })

  it("preselects the temporary model when it is the only model", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...options, models: [options.models[0]] }),
    )
    renderEvaluation()

    expect(
      await screen.findByRole("checkbox", { name: /Model A/ }),
    ).toBeChecked()
  })

  it("shows useful links when prompts and datasets are missing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ models: options.models, prompt_versions: [], datasets: [] }),
    )
    renderEvaluation()

    expect(await screen.findByText(/No prompt versions exist yet/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Create a prompt" })).toHaveAttribute(
      "href",
      "/prompts",
    )
    expect(screen.getByRole("link", { name: "Create a dataset" })).toHaveAttribute(
      "href",
      "/datasets",
    )
  })

  it("renders untrusted option text without interpreting HTML", async () => {
    const unsafe = '<img src="x" onerror="alert(1)">'
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...options,
        models: [{ ...options.models[0], name: unsafe }],
        prompt_versions: [
          { ...options.prompt_versions[0], content_preview: unsafe },
        ],
      }),
    )
    const { container } = renderEvaluation()

    expect(await screen.findAllByText(unsafe)).toHaveLength(2)
    expect(container.querySelector("img")).toBeNull()
  })

  it("shows sanitized option and preview errors", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse(options))
    renderEvaluation()
    await screen.findByRole("heading", { name: "Configure evaluation" })

    await user.click(screen.getByRole("checkbox", { name: /Model A/ }))
    await user.click(screen.getByRole("checkbox", { name: /Version 2/ }))
    await user.click(screen.getByRole("radio", { name: /Knowledge set/ }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Configuration exceeds the safe request limit." }, 422),
    )
    await user.click(screen.getByRole("button", { name: "Review configuration" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Configuration exceeds the safe request limit.",
    )

    await user.click(screen.getByRole("checkbox", { name: /Model A/ }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })
})
