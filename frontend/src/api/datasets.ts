export type MetadataValue = string | number | boolean | null
export type TestCaseMetadata = Record<string, MetadataValue>

export type TestCase = {
  id: string
  dataset_id: string
  input: string
  expected_answer: string
  category: string | null
  metadata: TestCaseMetadata | null
  created_at: string
  updated_at: string
}

export type DatasetSummary = {
  id: string
  name: string
  description: string | null
  test_case_count: number
  created_at: string
  updated_at: string
}

export type DatasetDetail = {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  test_cases: TestCase[]
}

export type TestCasePayload = {
  input: string
  expected_answer: string
  category: string | null
  metadata: TestCaseMetadata | null
}

export type DatasetCreate = {
  name: string
  description: string | null
  test_case: TestCasePayload
}

export type DatasetUpdate = {
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
    let message = "The dataset request could not be completed."
    try {
      const body = (await response.json()) as ApiError
      if (typeof body.detail === "string") message = body.detail
      if (Array.isArray(body.detail) && body.detail[0]?.msg) {
        message = body.detail[0].msg
      }
    } catch {
      // Keep the sanitized fallback for non-JSON server errors.
    }
    throw new Error(message)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

export function listDatasets() {
  return request<DatasetSummary[]>("/api/datasets")
}

export function createDataset(payload: DatasetCreate) {
  return request<DatasetDetail>("/api/datasets", jsonRequest("POST", payload))
}

export function getDataset(datasetId: string) {
  return request<DatasetDetail>(`/api/datasets/${datasetId}`)
}

export function updateDataset(datasetId: string, payload: DatasetUpdate) {
  return request<DatasetDetail>(
    `/api/datasets/${datasetId}`,
    jsonRequest("PATCH", payload),
  )
}

export function createTestCase(datasetId: string, payload: TestCasePayload) {
  return request<TestCase>(
    `/api/datasets/${datasetId}/test-cases`,
    jsonRequest("POST", payload),
  )
}

export function updateTestCase(
  datasetId: string,
  testCaseId: string,
  payload: TestCasePayload,
) {
  return request<TestCase>(
    `/api/datasets/${datasetId}/test-cases/${testCaseId}`,
    jsonRequest("PATCH", payload),
  )
}

export function deleteTestCase(datasetId: string, testCaseId: string) {
  return request<void>(`/api/datasets/${datasetId}/test-cases/${testCaseId}`, {
    method: "DELETE",
  })
}
