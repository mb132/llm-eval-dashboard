import { act, fireEvent, render as renderTestingLibrary, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode, type ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ModelConfiguration } from "@/api/models"
import type { ProviderConfiguration } from "@/api/providers"
import { ModelsPage } from "@/pages/models-page-v2"

function render(ui: ReactElement) {
  return renderTestingLibrary(<MemoryRouter>{ui}</MemoryRouter>)
}

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
    fetched_at: null,
    stale: false,
  },
  pricing_mode: "manual",
  pricing_fetched_at: null,
  requests_per_minute: null,
  max_concurrent_requests: null,
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

    expect((await screen.findAllByText("OpenAI work"))[0]).toBeInTheDocument()
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
    await user.type(screen.getByLabelText("Model ID"), "new-model")
    await user.click(screen.getByRole("radio", { name: "Manual" }))
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
    expect(await screen.findByText((_, element) => element?.tagName === "DIV" && element.textContent === "$1.25 in · $5.00 out")).toBeVisible()
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
    expect(screen.getByLabelText("Model ID")).toHaveValue("new-model")
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
      .mockResolvedValueOnce(jsonResponse({ available: true, supported: true, free_model_daily_requests: { used: 0, limit: 50, remaining: 50 }, limit_remaining_usd: 10, fetched_at: "2026-09-29T08:00:00Z" }))
      .mockResolvedValueOnce(jsonResponse({ ...model, provider: router, pricing_mode: "manual" }))
      .mockResolvedValueOnce(jsonResponse([provider, router]))
      .mockResolvedValueOnce(jsonResponse([{ ...model, provider: router }]))
      .mockResolvedValueOnce(jsonResponse({ available: true, supported: true, free_model_daily_requests: { used: 0, limit: 50, remaining: 50 }, limit_remaining_usd: 10, fetched_at: "2026-09-29T08:00:00Z" }))

    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Edit Flagship" }))
    expect(screen.getByRole("radio", { name: "Manual" })).toBeChecked()
    await user.selectOptions(screen.getByLabelText("Provider"), "2")
    expect(screen.getByRole("radio", { name: "Automatic" })).toBeChecked()
    expect(screen.getByText(/Changing the provider or model ID resets pricing/)).toBeVisible()
    await user.selectOptions(screen.getByLabelText("Provider"), "1")
    expect(screen.getByRole("radio", { name: "Manual" })).toBeChecked()
    expect(screen.getByLabelText("Input USD / 1M tokens")).toHaveValue(1.25)
    await user.selectOptions(screen.getByLabelText("Provider"), "2")
    await user.click(screen.getByRole("radio", { name: "Manual" }))
    await user.clear(screen.getByLabelText("Input USD / 1M tokens"))
    await user.type(screen.getByLabelText("Input USD / 1M tokens"), "3")
    await user.clear(screen.getByLabelText("Output USD / 1M tokens"))
    await user.type(screen.getByLabelText("Output USD / 1M tokens"), "4")
    await user.click(screen.getByRole("button", { name: "Save model" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7))
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toMatchObject({
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
    expect(screen.getByRole("button", { name: "Save model" })).toBeDisabled()
    expect(await screen.findByRole("alert")).toHaveTextContent("✕ not a valid JSON object")
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

  it("uses native pricing radios, traps dialog focus, and restores it on Escape", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([model]))
    render(<ModelsPage />)
    const trigger = await screen.findByRole("button", { name: "Edit Flagship" })
    await user.click(trigger)
    expect(screen.getByLabelText("Display name")).toHaveFocus()
    expect(screen.getByRole("radio", { name: "Manual" })).toBeChecked()
    const dialog = screen.getByRole("dialog")
    await user.tab({ shift: true })
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole("button", { name: "Save model" })).toHaveFocus()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("validates JSON objects and finite manual prices live, including valid zero rates", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([model]))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Edit Flagship" }))
    const save = screen.getByRole("button", { name: "Save model" })
    for (const value of ["[]", "null", "42", '"hello"', "invalid"]) {
      fireEvent.change(screen.getByLabelText("Default parameters"), { target: { value } })
      expect(save).toBeDisabled()
      expect(screen.getByRole("alert")).toHaveTextContent("not a valid JSON object")
    }
    fireEvent.change(screen.getByLabelText("Default parameters"), { target: { value: '{"temperature":0.5}' } })
    expect(screen.getByText("✓ valid JSON object")).toBeVisible()
    for (const value of ["", "-1", "1001", "0.0000001"]) {
      fireEvent.change(screen.getByLabelText("Input USD / 1M tokens"), { target: { value } })
      expect(save).toBeDisabled()
    }
    fireEvent.change(screen.getByLabelText("Input USD / 1M tokens"), { target: { value: "0" } })
    fireEvent.change(screen.getByLabelText("Output USD / 1M tokens"), { target: { value: "0" } })
    expect(save).toBeEnabled()
    expect(screen.getByText("✓ Cost will be estimated for new runs.")).toBeVisible()
    await user.click(screen.getByRole("radio", { name: "Catalog" }))
    await user.click(screen.getByRole("radio", { name: "Manual" }))
    expect(screen.getByLabelText("Input USD / 1M tokens")).toHaveValue(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("opens Add pricing in the existing edit dialog without changing unavailable pricing", async () => {
    const user = userEvent.setup()
    const unpriced = { ...model, pricing: null, pricing_mode: "unavailable" }
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([unpriced]))
    render(<ModelsPage />)
    const trigger = await screen.findByRole("button", { name: "Add pricing for Flagship" })
    await user.click(trigger)
    expect(screen.getByRole("dialog", { name: "Edit model" })).toBeVisible()
    expect(screen.getByRole("radio", { name: "Unavailable" })).toBeChecked()
    expect(document.activeElement).toContainElement(screen.getByRole("group", { name: "Pricing basis" }))
    await user.keyboard("{Escape}")
    expect(trigger).toHaveFocus()
  })

  it("keeps model removal inline, focuses Cancel, and restores focus on Escape", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([model]))
    render(<ModelsPage />)
    const trigger = await screen.findByRole("button", { name: "Remove Flagship" })
    await user.click(trigger)
    const confirm = screen.getByRole("alertdialog", { name: "Remove Flagship?" })
    expect(confirm).toHaveTextContent("Past runs keep their snapshot.")
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("guards repeated model removal, shows row-local errors, and allows retry", async () => {
    const user = userEvent.setup()
    let resolveDelete!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([model]))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveDelete = resolve }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([]))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Remove Flagship" }))
    const confirm = screen.getByRole("alertdialog")
    await user.dblClick(within(confirm).getByRole("button", { name: "Remove" }))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(within(confirm).getByRole("button", { name: "Removing…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Edit Flagship" })).toBeDisabled()
    await act(async () => resolveDelete(jsonResponse({ detail: "Try removing again" }, 409)))
    expect(screen.getByRole("alert")).toHaveTextContent("Try removing again")
    expect(screen.getByRole("alert").closest("tr")).toHaveTextContent("Flagship")
    await user.click(within(confirm).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(screen.queryByText("Flagship")).not.toBeInTheDocument())
    expect(fetchMock.mock.calls[3][1]?.method).toBe("DELETE")
  })

  it("blocks provider removal while it has models, and retries rejected empty-provider removal", async () => {
    const user = userEvent.setup()
    const populated = { ...provider, id: 2, display_name: "Populated", model_count: 1 }
    fetchMock.mockResolvedValueOnce(jsonResponse([provider, populated])).mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ detail: "A model was just added" }, 409))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([populated])).mockResolvedValueOnce(jsonResponse([]))
    render(<ModelsPage />)
    expect(await screen.findByRole("button", { name: "Remove Populated" })).toBeDisabled()
    expect(screen.getByText("Remove its models first.")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Remove OpenAI work" }))
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("A model was just added")
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove OpenAI work" })).not.toBeInTheDocument())
  })

  it("does not wait for optional OpenRouter quota and keeps missing quota values unknown", async () => {
    const router = { ...provider, kind: "openrouter", display_name: "Router" }
    let resolveLimits!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse([router])).mockResolvedValueOnce(jsonResponse([{ ...model, provider: router }]))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveLimits = resolve }))
    render(<ModelsPage />)
    expect(await screen.findByRole("button", { name: "Edit Flagship" })).toBeEnabled()
    expect(screen.queryByText("Loading models…")).not.toBeInTheDocument()
    expect(screen.getByText("Free-model daily quota unknown")).toBeVisible()
    await act(async () => resolveLimits(jsonResponse({ supported: true, available: true, free_model_daily_requests: { used: 5 }, fetched_at: null })))
    expect(screen.getByText("Free-model daily quota unknown · Remaining credit unknown")).toBeVisible()
    expect(screen.queryByText(/0 credit left/)).not.toBeInTheDocument()
  })

  it("falls back honestly after a quota failure and validates supported rate limits", async () => {
    const user = userEvent.setup()
    const router = { ...provider, kind: "openrouter" }
    fetchMock.mockResolvedValueOnce(jsonResponse([router])).mockResolvedValueOnce(jsonResponse([{ ...model, provider: router }])).mockRejectedValueOnce(new Error("Quota offline"))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Edit Flagship" }))
    expect(screen.getByText("Quota unknown · OpenRouter account metadata unavailable.")).toBeVisible()
    const save = screen.getByRole("button", { name: "Save model" })
    for (const value of ["0", "100001", "1.5"]) {
      fireEvent.change(screen.getByLabelText("Requests per minute"), { target: { value } })
      expect(save).toBeDisabled()
    }
    fireEvent.change(screen.getByLabelText("Requests per minute"), { target: { value: "100000" } })
    fireEvent.change(screen.getByLabelText("Concurrent requests"), { target: { value: "1001" } })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Concurrent requests"), { target: { value: "1000" } })
    expect(save).toBeEnabled()
  })

  it("scopes OpenRouter refresh progress and errors to its provider, guards repeats, and retries", async () => {
    const user = userEvent.setup()
    const router = { ...provider, kind: "openrouter", display_name: "Router" }
    let resolveRefresh!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse([router])).mockResolvedValueOnce(jsonResponse([{ ...model, provider: router }]))
      .mockResolvedValueOnce(jsonResponse({ supported: true, available: false, fetched_at: null }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
      .mockResolvedValueOnce(jsonResponse({ available: true, models: [{ ...model, provider: router, pricing: null }], message: "Fresh prices loaded" }))
    render(<ModelsPage />)
    const refresh = await screen.findByRole("button", { name: "Refresh prices for Router" })
    await user.dblClick(refresh)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(refresh).toBeDisabled()
    expect(screen.getByRole("button", { name: "Remove Router" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Edit Flagship" })).toBeEnabled()
    expect(screen.getByText("Refreshing prices…").closest("tr")).toHaveTextContent("Router")
    await act(async () => resolveRefresh(jsonResponse({ available: false, models: [{ ...model, provider: router }], message: "Catalog offline" })))
    expect(screen.getByRole("alert")).toHaveTextContent("Catalog offline")
    expect(screen.getByRole("alert").closest("tr")).toHaveTextContent("Router")
    await user.click(refresh)
    expect(await screen.findByText("Fresh prices loaded")).toBeVisible()
    expect(screen.getByRole("button", { name: "Add pricing for Flagship" })).toBeVisible()
  })

  it("shows actual stale fetch dates and does not substitute effective dates for missing retrieval dates", async () => {
    const second = { ...model, id: 2, display_name: "Missing fetch", model_name: "missing-fetch", pricing: { ...model.pricing!, source: "openrouter", stale: true, fetched_at: null } }
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([
      { ...model, pricing: { ...model.pricing!, source: "openrouter", stale: true, fetched_at: "2026-10-01T12:00:00Z" } }, second,
    ]))
    render(<ModelsPage />)
    const title = await screen.findByText("Flagship")
    expect(title.closest("tr")).toHaveTextContent("⚠ stale · fetched Oct 1, 2026")
    const missing = screen.getByText("Missing fetch").closest("tr")
    expect(missing).toHaveTextContent("effective 2026-08-31")
    expect(missing).toHaveTextContent("Fetch date unavailable")
    expect(missing).not.toHaveTextContent("fetched Aug 31")
  })

  it("renders long model identifiers and API text safely as text", async () => {
    const unsafe = '<img src=x onerror="alert(1)">' + "very-long-model-".repeat(30)
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([{ ...model, display_name: unsafe, model_name: unsafe, runnable: false, unavailable_reason: unsafe }]))
    render(<ModelsPage />)
    expect((await screen.findAllByText(unsafe))[0]).toBeVisible()
    expect(document.querySelector("img")).toBeNull()
    expect(screen.getByRole("button", { name: `Edit ${unsafe}` })).toBeEnabled()
    expect(screen.getByText(`⚠ ${unsafe}`)).toBeVisible()
  })

  it("keeps provider keys write-only, labels requirements accurately, and saves placeholder connections", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ ...provider, has_api_key: false }, 201))
      .mockResolvedValueOnce(jsonResponse([{ ...provider, has_api_key: false }])).mockResolvedValueOnce(jsonResponse([]))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Add provider" }))
    expect(screen.getByLabelText("Display name")).toHaveFocus()
    const optionalKey = screen.getByLabelText("API key (optional where supported)")
    expect(optionalKey).toHaveAttribute("type", "password")
    expect(optionalKey).toHaveAttribute("autocomplete", "off")
    expect(optionalKey).toHaveValue("")
    await user.type(optionalKey, "temporary-key")
    await user.selectOptions(screen.getByLabelText("Provider kind"), "custom")
    expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument()
    expect(screen.getByText(/API key unsupported/)).toBeVisible()
    await user.selectOptions(screen.getByLabelText("Provider kind"), "openai")
    expect(screen.getByLabelText("API key (required to run)")).toHaveValue("")
    expect(screen.queryByLabelText(/Base URL/)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText("Display name"), "Placeholder")
    expect(screen.getByText(/Missing API key/)).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Save provider" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ display_name: "Placeholder", kind: "openai", base_url: null })
    expect(screen.getByText("⚠ missing")).toBeVisible()
  })

  it("locks provider fields during save, retains the draft on failure, and restores focus on cancel", async () => {
    const user = userEvent.setup()
    let resolveSave!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse([]))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    render(<ModelsPage />)
    const trigger = await screen.findByRole("button", { name: "Add provider" })
    await user.click(trigger)
    await user.type(screen.getByLabelText("Display name"), "Local")
    await user.dblClick(screen.getByRole("button", { name: "Save provider" }))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.getByLabelText("Display name")).toBeDisabled()
    await act(async () => resolveSave(jsonResponse({ detail: "Provider save failed" }, 422)))
    expect(screen.getByRole("alert")).toHaveTextContent("Provider save failed")
    expect(screen.getByLabelText("Display name")).toHaveValue("Local")
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(trigger).toHaveFocus()
  })

  it("ignores a model save result after cancel and a new dialog opens", async () => {
    const user = userEvent.setup()
    let resolveSave!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([model]))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Edit Flagship" }))
    await user.dblClick(screen.getByRole("button", { name: "Save model" }))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.getByLabelText("Default parameters")).toBeDisabled()
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "Edit Flagship" }))
    await act(async () => resolveSave(jsonResponse(model)))
    expect(screen.getByRole("dialog", { name: "Edit model" })).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("ignores late initial list results after the page unmounts", async () => {
    let resolveProviders!: (response: Response) => void
    let resolveModels!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveProviders = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveModels = resolve }))
    const view = render(<ModelsPage />)
    view.unmount()
    await act(async () => {
      resolveProviders(jsonResponse([{ ...provider, kind: "openrouter" }]))
      resolveModels(jsonResponse([model]))
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText("Flagship")).not.toBeInTheDocument()
  })


  it("ignores an older price refresh after a newer model reload", async () => {
    const user = userEvent.setup()
    const router = { ...provider, kind: "openrouter", display_name: "Router" }
    const routerModel = { ...model, provider: router }
    let resolveRefresh!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse([router])).mockResolvedValueOnce(jsonResponse([routerModel]))
      .mockResolvedValueOnce(jsonResponse({ available: true, supported: true, fetched_at: null }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
      .mockResolvedValueOnce(jsonResponse({ ...routerModel, display_name: "Newest model" }))
      .mockResolvedValueOnce(jsonResponse([router]))
      .mockResolvedValueOnce(jsonResponse([{ ...routerModel, display_name: "Newest model" }]))
      .mockResolvedValueOnce(jsonResponse({ available: true, supported: true, fetched_at: null }))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Refresh prices for Router" }))
    await user.click(screen.getByRole("button", { name: "Edit Flagship" }))
    await user.clear(screen.getByLabelText("Display name"))
    await user.type(screen.getByLabelText("Display name"), "Newest model")
    await user.click(screen.getByRole("button", { name: "Save model" }))
    expect(await screen.findByText("Newest model")).toBeVisible()
    await act(async () => resolveRefresh(jsonResponse({ available: true, models: [routerModel], message: "Older response" })))
    expect(screen.getByText("Newest model")).toBeVisible()
    expect(screen.queryByText("Flagship")).not.toBeInTheDocument()
    expect(screen.queryByText("Older response")).not.toBeInTheDocument()
  })

  it("ignores optional quota and price refresh callbacks after unmount", async () => {
    const user = userEvent.setup()
    const router = { ...provider, kind: "openrouter", display_name: "Router" }
    let resolveLimits!: (response: Response) => void
    let resolveRefresh!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse([router])).mockResolvedValueOnce(jsonResponse([model]))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveLimits = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const view = render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Refresh prices for Router" }))
    view.unmount()
    await act(async () => {
      resolveLimits(jsonResponse({ available: true, supported: true, fetched_at: null }))
      resolveRefresh(jsonResponse({ available: true, models: [model], message: "Late refresh" }))
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(screen.queryByText("Late refresh")).not.toBeInTheDocument()
  })

  it("saves valid zero prices and OpenRouter limits in the exact request body", async () => {
    const user = userEvent.setup()
    const router = { ...provider, kind: "openrouter" }
    fetchMock.mockResolvedValueOnce(jsonResponse([router])).mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ available: true, supported: true, fetched_at: null }))
      .mockResolvedValueOnce(jsonResponse(model, 201))
      .mockResolvedValueOnce(jsonResponse([router])).mockResolvedValueOnce(jsonResponse([model]))
      .mockResolvedValueOnce(jsonResponse({ available: true, supported: true, fetched_at: null }))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Add model" }))
    await user.type(screen.getByLabelText("Display name"), "Free model")
    await user.type(screen.getByLabelText("Model ID"), "free-model")
    await user.click(screen.getByRole("radio", { name: "Manual" }))
    await user.type(screen.getByLabelText("Input USD / 1M tokens"), "0")
    await user.type(screen.getByLabelText("Output USD / 1M tokens"), "0")
    fireEvent.change(screen.getByLabelText("Default parameters"), { target: { value: '{"temperature":0.5}' } })
    await user.type(screen.getByLabelText("Requests per minute"), "60")
    await user.type(screen.getByLabelText("Concurrent requests"), "2")
    await user.click(screen.getByRole("button", { name: "Save model" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7))
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      display_name: "Free model", provider_id: 1, model_name: "free-model", parameters: { temperature: 0.5 }, active: true,
      requests_per_minute: 60, max_concurrent_requests: 2,
      pricing: { mode: "manual", input_usd_per_million_tokens: "0", output_usd_per_million_tokens: "0" },
    })
  })


  it("shows unknown counts and unavailable lists after an initial error, then retries", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Initial load failed" }, 503))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([model]))
    render(<ModelsPage />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Initial load failed")
    expect(screen.getByText("Models unavailable")).toBeVisible()
    expect(screen.getByText("Providers unavailable")).toBeVisible()
    expect(screen.queryByText("Add a provider first")).not.toBeInTheDocument()
    expect(screen.queryByText("No providers yet")).not.toBeInTheDocument()
    expect(screen.queryByText("0 · 0 active")).not.toBeInTheDocument()
    expect(screen.getAllByText("—")).toHaveLength(2)
    expect(screen.getByRole("button", { name: "Add model" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Flagship")).toBeVisible()
    expect(screen.getByText("1 · 1 active")).toBeVisible()
    expect(screen.getByRole("button", { name: "Add model" })).toBeEnabled()
  })

  it("retains known rows and counts when a subsequent reload fails", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([model]))
      .mockResolvedValueOnce(jsonResponse(model))
      .mockResolvedValueOnce(jsonResponse({ detail: "Reload failed" }, 503)).mockResolvedValueOnce(jsonResponse([]))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Edit Flagship" }))
    await user.click(screen.getByRole("button", { name: "Save model" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Reload failed")
    expect(screen.getByText("Flagship")).toBeVisible()
    expect(screen.getByText("1 · 1 active")).toBeVisible()
    expect(screen.getByRole("button", { name: "Add model" })).toBeEnabled()
    expect(screen.queryByText("Models unavailable")).not.toBeInTheDocument()
  })

  it("shows only provider-valid pricing modes and preserves unchanged OpenRouter catalog pricing", async () => {
    const user = userEvent.setup()
    const router = { ...provider, id: 2, display_name: "Router", kind: "openrouter" }
    const legacyCatalog = { ...model, provider: router, pricing_mode: "catalog" }
    fetchMock.mockResolvedValueOnce(jsonResponse([provider, router])).mockResolvedValueOnce(jsonResponse([legacyCatalog]))
      .mockResolvedValueOnce(jsonResponse({ available: true, supported: true, fetched_at: null }))
      .mockResolvedValueOnce(jsonResponse(legacyCatalog))
      .mockResolvedValueOnce(jsonResponse([provider, router])).mockResolvedValueOnce(jsonResponse([legacyCatalog]))
      .mockResolvedValueOnce(jsonResponse({ available: true, supported: true, fetched_at: null }))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Edit Flagship" }))
    expect(screen.getByRole("radio", { name: "Automatic" })).toBeChecked()
    expect(screen.queryByRole("radio", { name: "Catalog" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("radio")).toHaveLength(3)
    await user.selectOptions(screen.getByLabelText("Provider"), "1")
    expect(screen.getByRole("radio", { name: "Catalog" })).toBeChecked()
    expect(screen.queryByRole("radio", { name: "Automatic" })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("Provider"), "2")
    expect(screen.getByRole("radio", { name: "Automatic" })).toBeChecked()
    await user.click(screen.getByRole("button", { name: "Save model" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7))
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).not.toHaveProperty("pricing")
  })

  it("blocks provider refresh during removal and clears removal errors when cancelled", async () => {
    const user = userEvent.setup()
    const router = { ...provider, display_name: "Router", kind: "openrouter" }
    let resolveDelete!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(jsonResponse([router])).mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ available: true, supported: true, fetched_at: null }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveDelete = resolve }))
    render(<ModelsPage />)
    await user.click(await screen.findByRole("button", { name: "Remove Router" }))
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }))
    expect(screen.getByRole("button", { name: "Refresh prices for Router" })).toBeDisabled()
    await act(async () => resolveDelete(jsonResponse({ detail: "Removal failed" }, 409)))
    expect(screen.getByRole("alert")).toHaveTextContent("Removal failed")
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Refresh prices for Router" })).toBeEnabled()
  })

  it("shows stale pricing for any source and preserves effective metadata separately", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([provider])).mockResolvedValueOnce(jsonResponse([{ ...model, pricing: { ...model.pricing!, stale: true, fetched_at: "2026-10-02T12:00:00Z" } }]))
    render(<ModelsPage />)
    const name = await screen.findByText("Flagship")
    expect(name.closest("tr")).toHaveTextContent("manual · effective 2026-08-31")
    expect(name.closest("tr")).toHaveTextContent("⚠ stale · fetched Oct 2, 2026")
  })


  it("shows compact mobile endpoint hosts while retaining full URLs and singular model captions", async () => {
    const local = { ...provider, display_name: "Local", kind: "ollama", base_url: "http://localhost:11434/api", model_count: 1 }
    const invalid = { ...provider, id: 2, display_name: "Legacy", base_url: "legacy endpoint", model_count: 2 }
    fetchMock.mockResolvedValueOnce(jsonResponse([local, invalid])).mockResolvedValueOnce(jsonResponse([]))
    render(<ModelsPage />)
    const localRow = (await screen.findByText("Local")).closest("tr")!
    expect(within(localRow).getByText("localhost:11434")).toHaveAttribute("title", "http://localhost:11434/api")
    expect(within(localRow).getByText("http://localhost:11434/api")).toBeInTheDocument()
    expect(localRow).toHaveTextContent("1 model")
    expect(localRow).not.toHaveTextContent("1 models")
    const legacyRow = screen.getByText("Legacy").closest("tr")!
    expect(within(legacyRow).getAllByText("legacy endpoint")).toHaveLength(2)
    expect(legacyRow).toHaveTextContent("2 models")
  })

})
