import { type Provider, type ProviderConfigurationSummary } from "@/api/models"

export type ProviderConfiguration = ProviderConfigurationSummary & {
  model_count: number
  created_at: string
}

export type ProviderConfigurationInput = {
  display_name: string
  kind: Provider
  base_url: string | null
  api_key?: string | null
}

export type OpenRouterLimits = {
  available: boolean
  supported: boolean
  free_model_daily_requests?: { used?: number; limit?: number; remaining?: number } | null
  limit_remaining_usd?: number | null
  fetched_at: string | null
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? "Provider configuration could not be saved.")
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}

export const listProviders = () => request<ProviderConfiguration[]>("/api/providers")
export const createProvider = (input: ProviderConfigurationInput) => request<ProviderConfiguration>("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
export const updateProvider = (id: number, input: Partial<ProviderConfigurationInput>) => request<ProviderConfiguration>(`/api/providers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
export const deleteProvider = (id: number) => request<void>(`/api/providers/${id}`, { method: "DELETE" })
export const getOpenRouterLimits = (id: number) => request<OpenRouterLimits>(`/api/providers/${id}/limits`)
export const refreshOpenRouterPrices = (id: number) => request<{ models: import("@/api/models").ModelConfiguration[]; available: boolean; message: string | null }>(`/api/providers/${id}/refresh-pricing`, { method: "POST" })
