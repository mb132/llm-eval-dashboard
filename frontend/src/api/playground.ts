import type { Provider } from "@/api/models"

export type PlaygroundResult = {
  model_id: number
  display_name: string
  provider: Provider
  model_name: string
  response: string
  latency_ms: number
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  finish_reason: string | null
}

type PlaygroundInput = {
  model_id: number
  prompt: string
  system_prompt: string | null
}

type ApiError = { detail?: string | Array<{ msg?: string }> }

export async function runPlaygroundPrompt(
  input: PlaygroundInput,
): Promise<PlaygroundResult> {
  let response: Response
  try {
    response = await fetch("/api/playground/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error("Could not reach FastAPI. Check that the backend is running.")
  }

  if (!response.ok) {
    let message = "The prompt could not be completed."
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

  return (await response.json()) as PlaygroundResult
}
