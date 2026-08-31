export type EvaluationModelOption = {
  id: string
  provider: string
  name: string
  model_name: string
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

export type EvaluationRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"

export type EvaluationResultStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"

export type QualityScore = {
  method: string
  version: number
  score: number | null
}

export type QualityAggregate = {
  average_score: number | null
  scored_results: number
  unavailable_results: number
}

export type ModelQualityAggregate = QualityAggregate & {
  model_id: string
  model_name: string
}

export type PromptQualityAggregate = QualityAggregate & {
  prompt_version_id: string
  prompt_name: string
  prompt_version_number: number
}

export type QualityMetricSummary = {
  method: string
  version: number
  overall: QualityAggregate
  by_model: ModelQualityAggregate[]
  by_prompt_version: PromptQualityAggregate[]
}

export type EvaluationQualitySummary = {
  metrics: QualityMetricSummary[]
}

export type SecurityAggregate = {
  score: number | null
  total_tests: number
  passed_tests: number
  failed_tests: number
  unavailable_tests: number
}

export type ModelSecurityAggregate = SecurityAggregate & {
  model_id: string
  model_name: string
}

export type PromptSecurityAggregate = SecurityAggregate & {
  prompt_version_id: string
  prompt_name: string
  prompt_version_number: number
}

export type EvaluationSecuritySummary = {
  metric_version: number
  overall: SecurityAggregate
  by_model: ModelSecurityAggregate[]
  by_prompt_version: PromptSecurityAggregate[]
}

export type LatencyAggregate = {
  average_ms: number | null
  minimum_ms: number | null
  maximum_ms: number | null
  recorded_results: number
  unavailable_results: number
}

export type ModelLatencyAggregate = LatencyAggregate & {
  model_id: string
  model_name: string
}

export type TokenAggregate = {
  sum_tokens: number | null
  recorded_results: number
  unavailable_results: number
}

export type EvaluationPerformanceSummary = {
  latency: LatencyAggregate
  latency_by_model: ModelLatencyAggregate[]
  input_tokens: TokenAggregate
  output_tokens: TokenAggregate
  total_tokens: TokenAggregate
}

export type CostAggregate = {
  estimated_usd: string | null
  priced_results: number
  unavailable_results: number
}

export type ModelCostAggregate = CostAggregate & {
  model_id: string
  model_name: string
}

export type EvaluationCostSummary = {
  overall: CostAggregate
  average_complete_test_case_usd: string | null
  complete_test_cases: number
  incomplete_test_cases: number
  by_model: ModelCostAggregate[]
}

export type PricingSnapshot = {
  input_usd_per_million_tokens: string
  output_usd_per_million_tokens: string
  currency: string
  source: string
  effective_date: string
  source_url: string | null
}

export type EvaluationRun = {
  id: string
  status: EvaluationRunStatus
  dataset_id: string
  dataset_name: string
  repetitions: number
  total_requests: number
  completed_requests: number
  successful_requests: number
  failed_requests: number
  failure_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export type EvaluationResult = {
  id: string
  sequence_number: number
  status: EvaluationResultStatus
  model_id: string
  model_provider: string
  model_name: string
  reported_model_name: string | null
  prompt_id: string
  prompt_version_id: string
  prompt_name: string
  prompt_version_number: number
  test_case_id: string
  case_type: "standard" | "security"
  security_test_type:
    | "direct_prompt_injection"
    | "instruction_override"
    | "system_prompt_extraction"
    | null
  security_metric_version: number | null
  security_status: "passed" | "failed" | "unavailable" | null
  repetition: number
  max_output_tokens: number
  rendered_prompt: string
  test_input: string
  expected_output: string
  generated_output: string | null
  error_code: string | null
  error_message: string | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  pricing: PricingSnapshot | null
  estimated_cost_usd: string | null
  quality_scores: QualityScore[]
  started_at: string | null
  completed_at: string | null
}

export type EvaluationRunPage = {
  items: EvaluationRun[]
  total: number
  completed: number
  failed: number
  offset: number
  limit: number
}

export type EvaluationResultPage = {
  items: EvaluationResult[]
  total: number
  offset: number
  limit: number
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

export function startEvaluation(
  configuration: EvaluationConfiguration,
): Promise<EvaluationRun> {
  return request<EvaluationRun>("/api/evaluations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(configuration),
  })
}

export function getEvaluationRun(evaluationId: string): Promise<EvaluationRun> {
  return request<EvaluationRun>(`/api/evaluations/${evaluationId}`)
}

export function getPastEvaluations(
  offset = 0,
  limit = 20,
): Promise<EvaluationRunPage> {
  const query = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  })
  return request<EvaluationRunPage>(`/api/evaluations?${query}`)
}

export function getEvaluationResults(
  evaluationId: string,
  offset = 0,
  limit = 50,
): Promise<EvaluationResultPage> {
  const query = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  })
  return request<EvaluationResultPage>(
    `/api/evaluations/${evaluationId}/results?${query}`,
  )
}

export function getEvaluationQualitySummary(
  evaluationId: string,
): Promise<EvaluationQualitySummary> {
  return request<EvaluationQualitySummary>(
    `/api/evaluations/${evaluationId}/quality-summary`,
  )
}

export function getEvaluationSecuritySummary(
  evaluationId: string,
): Promise<EvaluationSecuritySummary> {
  return request<EvaluationSecuritySummary>(
    `/api/evaluations/${evaluationId}/security-summary`,
  )
}

export function getEvaluationPerformanceSummary(
  evaluationId: string,
): Promise<EvaluationPerformanceSummary> {
  return request<EvaluationPerformanceSummary>(
    `/api/evaluations/${evaluationId}/performance-summary`,
  )
}

export function getEvaluationCostSummary(
  evaluationId: string,
): Promise<EvaluationCostSummary> {
  return request<EvaluationCostSummary>(
    `/api/evaluations/${evaluationId}/cost-summary`,
  )
}
