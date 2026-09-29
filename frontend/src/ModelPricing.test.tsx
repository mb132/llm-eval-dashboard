import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ModelConfiguration } from "@/api/models"
import type { ProviderConfiguration } from "@/api/providers"
import { ModelsPage } from "@/pages/models-page-v2"

const provider: ProviderConfiguration = {
  id: 1,
  display_name: "OpenAI work",
  kind: "openai",
  base_url: null,
  has_api_key: true,
  api_key_requirement: "required",
  model_count: 0,
  created_at: "2026-08-31T08:00:00Z",
}

const model: ModelConfiguration = {
  id: 1,
  display_name: "Flagship",
  provider,
  model_name: "new-model",
  parameters: {},
  active: true,
  runnable: true,
  unavailable_reason: null,
  pricing: {
    input_usd_per_million_tokens: "1.250000",
    output_usd_per_million_tokens: "5.000000",
    currency: "USD",
    source: "manual",
    effective_date: "2026-08-31",
    source_url: null,
  },
  created_at: "2026-08-31T08:00:00Z",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("model pricing", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("keeps stable loading states until providers and models are both available", async () => {
    let resolveProviders!: (response: Response) => void
    let resolveModels!: (response: Response) => void
    const providersResponse = new Promise<Response>((resolve) => {
      resolveProviders = resolve
    })
    const modelsResponse = new Promise<Response>((resolve) => {
      resolveModels = resolve
    })
    fetchMock.mockImplementation((input) =>
      String(input) === "/api/providers" ? providersResponse : modelsResponse,
    )

    render(<StrictMode><ModelsPage /></StrictMode>)

    expect(screen.getByText("Loading providers…")).toBeInTheDocument()
    expect(screen.getByText("Loading models…")).toBeInTheDocument()
    expect(screen.queryByText(/No providers yet/)).not.toBeInTheDocument()
    expect(screen.queryByText("Create a provider first.")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add provider" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Add model" })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveProviders(jsonResponse([provider]))
      resolveModels(jsonResponse([model]))
    })

    expect(await screen.findByText("OpenAI work")).toBeInTheDocument()
    expect(screen.getByText("Flagship")).toBeInTheDocument()
    expect(screen.queryByText("Loading providers…")).not.toBeInTheDocument()
  })

  it("creates an unknown model with explicit manual rates", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([provider]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(model, 201))
      .mockResolvedValueOnce(jsonResponse([provider]))
      .mockResolvedValueOnce(jsonResponse([model]))

    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Add model" }))
    await user.type(screen.getByLabelText("Display name"), "Flagship")
    await user.type(screen.getByLabelText("Model name"), "new-model")
    await user.selectOptions(screen.getByLabelText("Pricing basis"), "manual")
    await user.type(screen.getByLabelText("Input USD / 1M tokens"), "1.25")
    await user.type(screen.getByLabelText("Output USD / 1M tokens"), "5")
    await user.click(screen.getByRole("button", { name: "Save model" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      display_name: "Flagship",
      provider_id: 1,
      model_name: "new-model",
      parameters: {},
      active: true,
      pricing: {
        mode: "manual",
        input_usd_per_million_tokens: "1.25",
        output_usd_per_million_tokens: "5",
      },
    })
    expect(await screen.findByText(/Estimated pricing: \$1\.250000/)).toBeVisible()
  })

  it("edits the whole model while preserving pricing when identity is unchanged", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([provider]))
      .mockResolvedValueOnce(jsonResponse([model]))
      .mockResolvedValueOnce(jsonResponse({ ...model, display_name: "Renamed" }))
      .mockResolvedValueOnce(jsonResponse([provider]))
      .mockResolvedValueOnce(jsonResponse([{ ...model, display_name: "Renamed" }]))

    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Edit Flagship" }))
    expect(screen.getByRole("dialog", { name: "Edit model" })).toBeVisible()
    expect(screen.getByLabelText("Display name")).toHaveValue("Flagship")
    expect(screen.getByLabelText("Model name")).toHaveValue("new-model")
    expect(screen.getByLabelText("Active")).toBeChecked()
    await user.clear(screen.getByLabelText("Display name"))
    await user.type(screen.getByLabelText("Display name"), "Renamed")
    await user.click(screen.getByLabelText("Active"))
    await user.click(screen.getByRole("button", { name: "Save model" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    const input = JSON.parse(String(fetchMock.mock.calls[2][1]?.body))
    expect(input).toMatchObject({ display_name: "Renamed", active: false, model_name: "new-model" })
    expect(input).not.toHaveProperty("pricing")
  })

  it("resets pricing when switching to OpenRouter and accepts manual replacement rates", async () => {
    const user = userEvent.setup()
    const router: ProviderConfiguration = {
      ...provider,
      id: 2,
      display_name: "OpenRouter account",
      kind: "openrouter",
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse([provider, router]))
      .mockResolvedValueOnce(jsonResponse([model]))
      .mockResolvedValueOnce(jsonResponse({ ...model, provider: router }))
      .mockResolvedValueOnce(jsonResponse([provider, router]))
      .mockResolvedValueOnce(jsonResponse([{ ...model, provider: router }]))

    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Edit Flagship" }))
    expect(screen.getByLabelText("Pricing basis")).toHaveValue("manual")
    await user.selectOptions(screen.getByLabelText("Provider"), "2")
    expect(screen.getByLabelText("Pricing basis")).toHaveValue("catalog")
    expect(screen.getByText(/Changing the provider or model ID resets pricing/)).toBeVisible()
    await user.selectOptions(screen.getByLabelText("Provider"), "1")
    expect(screen.getByLabelText("Pricing basis")).toHaveValue("manual")
    expect(screen.getByLabelText("Input USD / 1M tokens")).toHaveValue(1.25)
    await user.selectOptions(screen.getByLabelText("Provider"), "2")
    await user.selectOptions(screen.getByLabelText("Pricing basis"), "manual")
    await user.clear(screen.getByLabelText("Input USD / 1M tokens"))
    await user.type(screen.getByLabelText("Input USD / 1M tokens"), "3")
    await user.clear(screen.getByLabelText("Output USD / 1M tokens"))
    await user.type(screen.getByLabelText("Output USD / 1M tokens"), "4")
    await user.click(screen.getByRole("button", { name: "Save model" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      provider_id: 2,
      pricing: {
        mode: "manual",
        input_usd_per_million_tokens: "3",
        output_usd_per_million_tokens: "4",
      },
    })
  })

  it("keeps edits after a validation error and discards them when the dialog closes", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([provider]))
      .mockResolvedValueOnce(jsonResponse([model]))
      .mockResolvedValueOnce(jsonResponse({ detail: "Save failed" }, 422))

    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Edit Flagship" }))
    await user.clear(screen.getByLabelText("Display name"))
    await user.type(screen.getByLabelText("Display name"), "Changed")
    await user.clear(screen.getByLabelText("Default parameters"))
    await user.type(screen.getByLabelText("Default parameters"), "invalid")
    await user.click(screen.getByRole("button", { name: "Save model" }))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText("Display name")).toHaveValue("Changed")

    fireEvent.change(screen.getByLabelText("Default parameters"), { target: { value: "{}" } })
    await user.click(screen.getByRole("button", { name: "Save model" }))
    expect(await screen.findByText("Save failed")).toBeVisible()
    expect(screen.getByLabelText("Display name")).toHaveValue("Changed")
    await user.click(screen.getByRole("button", { name: "Close" }))
    await user.click(screen.getByRole("button", { name: "Edit Flagship" }))
    expect(screen.getByLabelText("Display name")).toHaveValue("Flagship")
    expect(screen.queryByText("Save failed")).not.toBeInTheDocument()
  })
})
