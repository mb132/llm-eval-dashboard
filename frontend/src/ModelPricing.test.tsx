import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
})
