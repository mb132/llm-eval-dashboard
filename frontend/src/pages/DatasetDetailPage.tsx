import {
  AlertCircle,
  ArrowLeft,
  Edit3,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
  Download,
  FileUp,
} from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { Link, useParams } from "react-router-dom"

import {
  createTestCase,
  deleteTestCase,
  getDataset,
  updateDataset,
  updateTestCase,
  type DatasetDetail,
  type TestCase,
  type TestCasePayload,
} from "@/api/datasets"
import { TestCaseForm } from "@/components/TestCaseForm"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { download } from "@/lib/download"

export function DatasetDetailPage() {
  const { datasetId } = useParams()
  const [dataset, setDataset] = useState<DatasetDetail | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState("")
  const [isSavingMetadata, setIsSavingMetadata] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [addFormKey, setAddFormKey] = useState(0)

  useEffect(() => {
    let active = true
    if (!datasetId) {
      setPageError("Dataset not found.")
      setIsLoading(false)
      return
    }
    getDataset(datasetId)
      .then((result) => {
        if (!active) return
        setDataset(result)
        setName(result.name)
        setDescription(result.description ?? "")
      })
      .catch((error: unknown) => {
        if (active) {
          setPageError(error instanceof Error ? error.message : "Could not load dataset.")
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [datasetId])

  async function handleMetadataSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!datasetId || !name.trim()) {
      setMetadataError("Dataset name is required.")
      return
    }
    setIsSavingMetadata(true)
    setMetadataError(null)
    setStatusMessage("")
    try {
      const updated = await updateDataset(datasetId, {
        name: name.trim(),
        description: description.trim() || null,
      })
      setDataset(updated)
      setName(updated.name)
      setDescription(updated.description ?? "")
      setStatusMessage("Dataset details saved.")
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : "Could not save dataset.")
    } finally {
      setIsSavingMetadata(false)
    }
  }

  async function handleAdd(payload: TestCasePayload) {
    if (!datasetId || !dataset) return
    setIsAdding(true)
    setAddError(null)
    setStatusMessage("")
    try {
      const created = await createTestCase(datasetId, payload)
      setDataset((current) =>
        current
          ? {
              ...current,
              updated_at: created.created_at,
              test_cases: [...current.test_cases, created],
            }
          : current,
      )
      setAddFormKey((value) => value + 1)
      setStatusMessage("Test case added.")
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Could not add test case.")
    } finally {
      setIsAdding(false)
    }
  }

  function replaceTestCase(updated: TestCase) {
    setDataset((current) =>
      current
        ? {
            ...current,
            updated_at: updated.updated_at,
            test_cases: current.test_cases.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          }
        : current,
    )
    setStatusMessage("Test case saved.")
  }

  function removeTestCase(testCaseId: string) {
    setDataset((current) =>
      current
        ? {
            ...current,
            test_cases: current.test_cases.filter(
              (item) => item.id !== testCaseId,
            ),
          }
        : current,
    )
    setStatusMessage("Test case deleted.")
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading dataset…
      </div>
    )
  }

  if (pageError || !dataset || !datasetId) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorMessage message={pageError ?? "Dataset not found."} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <BackLink />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge variant="secondary">Evaluation dataset</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {dataset.name}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Manage reusable, traceable test cases.
          </p>
        </div>
        <Badge variant="outline">
          {dataset.test_cases.length} {dataset.test_cases.length === 1 ? "case" : "cases"}
        </Badge>
        <div className="flex gap-2"><Link to={`/datasets/import?dataset=${datasetId}`} className={buttonVariants({ variant: "outline", size: "sm" })}><FileUp className="size-4" />Import cases</Link><Button type="button" variant="outline" size="sm" onClick={() => void download(`/api/datasets/${datasetId}/export?format=json`, `${dataset.name}.json`)}><Download className="size-4" />Export JSON</Button><Button type="button" variant="outline" size="sm" onClick={() => void download(`/api/datasets/${datasetId}/export?format=csv`, `${dataset.name}.csv`)}><Download className="size-4" />CSV</Button></div>
      </header>

      {statusMessage && (
        <Alert variant="success" role="status">
          {statusMessage}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>
              <h2>Dataset details</h2>
            </CardTitle>
            <CardDescription>
              Keep the collection easy to identify when configuring evaluations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleMetadataSave} noValidate>
              <div className="space-y-2">
                <label
                  htmlFor="detail-dataset-name"
                  className="text-sm font-medium"
                >
                  Name
                </label>
                <Input
                  id="detail-dataset-name"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="detail-dataset-description"
                  className="flex items-center justify-between text-sm font-medium"
                >
                  Description
                  <span className="text-xs font-normal text-muted-foreground">
                    Optional
                  </span>
                </label>
                <Textarea
                  id="detail-dataset-description"
                  className="min-h-24 font-sans"
                  value={description}
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              {metadataError && <ErrorMessage message={metadataError} />}
              <Button type="submit" disabled={isSavingMetadata}>
                {isSavingMetadata ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {isSavingMetadata ? "Saving…" : "Save details"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>
              <h2>Add test case</h2>
            </CardTitle>
            <CardDescription>
              Inputs and expected answers are required for every case.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TestCaseForm
              key={addFormKey}
              submitLabel="Add test case"
              busy={isAdding}
              disabled={dataset.test_cases.length >= 500}
              error={
                addError ??
                (dataset.test_cases.length >= 500
                  ? "This dataset has reached the limit of 500 test cases."
                  : null)
              }
              onSubmit={handleAdd}
            />
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="test-cases-heading">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="test-cases-heading" className="text-xl font-semibold">
              Test cases
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Stable IDs preserve their source identity for future evaluation
              snapshots.
            </p>
          </div>
          <Badge variant="outline">
            <Plus className="mr-1 size-3" />
            Up to 500
          </Badge>
        </div>
        <div className="mt-4 space-y-4">
          {dataset.test_cases.map((testCase, index) => (
            <TestCaseCard
              key={testCase.id}
              datasetId={datasetId}
              testCase={testCase}
              index={index}
              canDelete={dataset.test_cases.length > 1}
              onUpdated={replaceTestCase}
              onDeleted={removeTestCase}
              onStatusClear={() => setStatusMessage("")}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function TestCaseCard({
  datasetId,
  testCase,
  index,
  canDelete,
  onUpdated,
  onDeleted,
  onStatusClear,
}: {
  datasetId: string
  testCase: TestCase
  index: number
  canDelete: boolean
  onUpdated: (testCase: TestCase) => void
  onDeleted: (testCaseId: string) => void
  onStatusClear: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpdate(payload: TestCasePayload) {
    setIsSaving(true)
    setError(null)
    onStatusClear()
    try {
      const updated = await updateTestCase(datasetId, testCase.id, payload)
      onUpdated(updated)
      setIsEditing(false)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not save test case.")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    setError(null)
    onStatusClear()
    try {
      await deleteTestCase(datasetId, testCase.id)
      onDeleted(testCase.id)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not delete test case.")
      setConfirmDelete(false)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <article className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Case {index + 1}</Badge>
          <Badge variant={testCase.case_type === "security" ? "outline" : "secondary"}>
            {testCase.case_type === "security" ? "Security" : "Standard"}
          </Badge>
          {testCase.security_test_type && (
            <Badge variant="outline">
              {securityTypeLabel(testCase.security_test_type)}
            </Badge>
          )}
          {testCase.category && <Badge variant="outline">{testCase.category}</Badge>}
        </div>
        {!isEditing && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { setIsEditing(true); setError(null) }}>
              <Edit3 className="size-4" />Edit
            </Button>
            {!confirmDelete ? (
              <Button type="button" variant="outline" size="sm" disabled={!canDelete} title={canDelete ? undefined : "A dataset must keep at least one test case."} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" />Delete
              </Button>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-destructive-border bg-destructive-soft p-1">
                <span className="px-1 text-xs text-destructive-soft-foreground">Delete this case?</span>
                <Button type="button" size="xs" disabled={isDeleting} onClick={handleDelete}>{isDeleting ? "Deleting…" : "Confirm"}</Button>
                <Button type="button" variant="outline" size="xs" disabled={isDeleting} onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </div>
            )}
            {!canDelete && (
              <span className="self-center text-xs text-muted-foreground">
                At least one case is required.
              </span>
            )}
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="mt-5 border-t pt-5">
          <TestCaseForm
            initial={{ input: testCase.input, expected_answer: testCase.expected_answer, case_type: testCase.case_type, security_test_type: testCase.security_test_type, category: testCase.category, metadata: testCase.metadata }}
            submitLabel="Save test case"
            busy={isSaving}
            error={error}
            onSubmit={handleUpdate}
            onCancel={() => { setIsEditing(false); setError(null) }}
          />
        </div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <TextBlock label="Input" value={testCase.input} />
          <TextBlock
            label={testCase.case_type === "security" ? "Failure marker" : "Expected answer"}
            value={testCase.expected_answer}
          />
          {testCase.metadata && Object.keys(testCase.metadata).length > 0 && (
            <div className="md:col-span-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Metadata</h3>
              <dl className="mt-2 flex flex-wrap gap-2">
                {Object.entries(testCase.metadata).map(([key, value]) => (
                  <div key={key} className="rounded-md bg-muted px-3 py-2 text-sm"><dt className="inline font-medium">{key}: </dt><dd className="inline text-muted-foreground">{formatMetadataValue(value)}</dd></div>
                ))}
              </dl>
            </div>
          )}
          {error && <div className="md:col-span-2"><ErrorMessage message={error} /></div>}
        </div>
      )}
    </article>
  )
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return <div><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3><p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm leading-relaxed">{value}</p></div>
}

function formatMetadataValue(value: string | number | boolean | null) {
  if (value === null) return "null"
  return String(value)
}

function securityTypeLabel(value: string) {
  return value.replaceAll("_", " ")
}

function BackLink() {
  return <Link to="/datasets" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"><ArrowLeft className="size-4" />Back to datasets</Link>
}

function ErrorMessage({ message }: { message: string }) {
  return <Alert variant="destructive" className="flex gap-2" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" /><p>{message}</p></Alert>
}
