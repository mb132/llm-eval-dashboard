export type PromptVersion = {
  id: string
  prompt_id: string
  version_number: number
  content: string
  created_at: string
}

export type PromptSummary = {
  id: string
  name: string
  description: string | null
  latest_version_number: number
  created_at: string
  updated_at: string
}

export type PromptDetail = {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  versions: PromptVersion[]
}

export type PromptCreate = {
  name: string
  description: string | null
  content: string
}

export type PromptUpdate = {
  name?: string
  description?: string | null
}

type ValidationIssue = { msg?: string }
type ApiError = { detail?: string | ValidationIssue[] }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new Error("Could not reach FastAPI. Check that the backend is running.")
  }

  if (!response.ok) {
    let message = "The prompt request could not be completed."
    try {
      const body = (await response.json()) as ApiError
      if (typeof body.detail === "string") {
        message = body.detail
      } else if (Array.isArray(body.detail)) {
        const issues = body.detail.flatMap((issue) =>
          typeof issue.msg === "string" ? [issue.msg] : [],
        )
        if (issues.length > 0) message = issues.join(" ")
      }
    } catch {
      // Keep the sanitized fallback for non-JSON server errors.
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

export function listPrompts(): Promise<PromptSummary[]> {
  return request<PromptSummary[]>("/api/prompts")
}

export function getPrompt(promptId: string): Promise<PromptDetail> {
  return request<PromptDetail>(`/api/prompts/${encodeURIComponent(promptId)}`)
}

export function createPrompt(payload: PromptCreate): Promise<PromptDetail> {
  return request<PromptDetail>("/api/prompts", jsonRequest("POST", payload))
}

export function updatePrompt(
  promptId: string,
  payload: PromptUpdate,
): Promise<PromptDetail> {
  return request<PromptDetail>(
    `/api/prompts/${encodeURIComponent(promptId)}`,
    jsonRequest("PATCH", payload),
  )
}

export function createPromptVersion(
  promptId: string,
  content: string,
): Promise<PromptVersion> {
  return request<PromptVersion>(
    `/api/prompts/${encodeURIComponent(promptId)}/versions`,
    jsonRequest("POST", { content }),
  )
}
