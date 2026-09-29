export const PROVIDERS = [
  "ollama",
  "openai",
  "openrouter",
  "anthropic",
  "gemini",
  "openai_compatible",
  "custom",
] as const

export type Provider = (typeof PROVIDERS)[number]

export type ModelConfiguration = {
  id: number
  display_name: string
  provider: ProviderConfigurationSummary
  model_name: string
  parameters: Record<string, unknown>
  active: boolean
  runnable: boolean
  unavailable_reason: string | null
  pricing: ModelPricing | null
  pricing_mode?: PricingSelection["mode"]
  pricing_fetched_at?: string | null
  requests_per_minute?: number | null
  max_concurrent_requests?: number | null
  created_at: string
}

export type PricingSelection =
  | { mode: "catalog" | "automatic" }
  | {
      mode: "manual"
      input_usd_per_million_tokens: string
      output_usd_per_million_tokens: string
    }
  | { mode: "unavailable" }

export type ModelPricing = {
  input_usd_per_million_tokens: string
  output_usd_per_million_tokens: string
  currency: "USD"
  source: "catalog" | "openrouter" | "manual"
  effective_date: string
  source_url: string | null
  fetched_at?: string | null
  stale?: boolean
}

export type ModelConfigurationInput = {
  display_name: string
  provider_id: number
  model_name: string
  parameters: Record<string, unknown>
  active: boolean
  pricing?: PricingSelection
  requests_per_minute?: number | null
  max_concurrent_requests?: number | null
}

export type ProviderConfigurationSummary = {
  id: number
  display_name: string
  kind: Provider
  base_url: string | null
  has_api_key: boolean
  api_key_requirement: "required" | "optional" | "unsupported"
}

type ApiError = { detail?: string | Array<{ msg?: string }> }

export async function listModels(): Promise<ModelConfiguration[]> {
  return request<ModelConfiguration[]>("/api/models")
}

export async function createModel(
  input: ModelConfigurationInput,
): Promise<ModelConfiguration> {
  return request<ModelConfiguration>("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export async function updateModel(
  id: number,
  input: Partial<ModelConfigurationInput>,
): Promise<ModelConfiguration> {
  return request<ModelConfiguration>(`/api/models/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export async function deleteModel(id: number): Promise<void> {
  await request<void>(`/api/models/${id}`, { method: "DELETE" })
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, options)
  } catch {
    throw new Error("Could not reach FastAPI. Check that the backend is running.")
  }

  if (!response.ok) {
    let message = "The model configuration could not be saved."
    try {
      const body = (await response.json()) as ApiError
      if (typeof body.detail === "string") message = body.detail
      if (Array.isArray(body.detail)) {
        message = body.detail.map((error) => error.msg).filter(Boolean).join(" ")
      }
    } catch {
      // Keep the fallback for non-JSON server errors.
    }
    throw new Error(message)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
