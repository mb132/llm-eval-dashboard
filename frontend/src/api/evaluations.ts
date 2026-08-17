export type EvaluationResult = {
  model: string
  response: string
  latency_ms: number
  input_tokens: number | null
  output_tokens: number | null
}

type ApiError = {
  detail?: string
}

export async function runEvaluation(): Promise<EvaluationResult> {
  let response: Response

  try {
    response = await fetch("/api/evaluations/run", { method: "POST" })
  } catch {
    throw new Error("Could not reach FastAPI. Check that the backend is running.")
  }

  if (!response.ok) {
    let message = "The evaluation could not be completed."
    try {
      const body = (await response.json()) as ApiError
      if (body.detail) message = body.detail
    } catch {
      // Keep the fallback for non-JSON server errors.
    }
    throw new Error(message)
  }

  return (await response.json()) as EvaluationResult
}
