export type EvaluationModelOption = {
  id: string
  provider: string
  name: string
}

export type EvaluationPromptVersionOption = {
  id: string
  prompt_id: string
  prompt_name: string
  version_number: number
  content_preview: string
}

export type EvaluationDatasetOption = {
  id: string
  name: string
  test_case_count: number
}

export type EvaluationOptions = {
  models: EvaluationModelOption[]
  prompt_versions: EvaluationPromptVersionOption[]
  datasets: EvaluationDatasetOption[]
}

export type EvaluationConfiguration = {
  model_ids: string[]
  prompt_version_ids: string[]
  dataset_id: string
  repetitions: number
}

export type EvaluationPreview = EvaluationConfiguration & {
  model_count: number
  prompt_version_count: number
  test_case_count: number
  combination_count: number
  total_requests: number
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
    let message = "The evaluation configuration could not be processed."
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

export function getEvaluationOptions(): Promise<EvaluationOptions> {
  return request<EvaluationOptions>("/api/evaluations/options")
}

export function previewEvaluation(
  configuration: EvaluationConfiguration,
): Promise<EvaluationPreview> {
  return request<EvaluationPreview>("/api/evaluations/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(configuration),
  })
}
