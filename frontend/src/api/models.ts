export const PROVIDERS = [
  "ollama",
  "openai",
  "anthropic",
  "gemini",
  "openai_compatible",
  "custom",
] as const

export type Provider = (typeof PROVIDERS)[number]

export type ModelConfiguration = {
  id: number
  display_name: string
  provider: Provider
  model_name: string
  base_url: string | null
  api_key_env_var: string | null
  has_credentials: boolean
  parameters: Record<string, unknown>
  active: boolean
  created_at: string
}

export type ModelConfigurationInput = {
  display_name: string
  provider: Provider
  model_name: string
  base_url: string | null
  api_key_env_var: string | null
  parameters: Record<string, unknown>
  active: boolean
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
