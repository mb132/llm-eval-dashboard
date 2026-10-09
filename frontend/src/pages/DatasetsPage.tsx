import { AlertCircle, Database, FileUp, LoaderCircle, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import {
  createDataset,
  listDatasets,
  type DatasetSummary,
  type TestCasePayload,
} from "@/api/datasets"
import { TestCaseForm } from "@/components/TestCaseForm"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export function DatasetsPage() {
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    let active = true
    listDatasets()
      .then((result) => {
        if (active) setDatasets(result)
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "Could not load datasets.")
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleCreate(testCase: TestCasePayload) {
    if (!name.trim()) {
      setFormError("Dataset name is required.")
      return
    }
    setIsCreating(true)
    setFormError(null)
    try {
      const created = await createDataset({
        name: name.trim(),
        description: description.trim() || null,
        test_case: testCase,
      })
      navigate(`/datasets/${created.id}`)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create dataset.")
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Badge variant="secondary">Reusable test data</Badge>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Datasets</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Build traceable collections of inputs and expected answers for repeatable evaluations.
          </p>
        </div>
        <Link to="/datasets/import" className={buttonVariants({ variant: "outline" })}><FileUp className="size-4" />Import dataset</Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.9fr)]">
        <section aria-labelledby="saved-datasets-heading">
          <h2 id="saved-datasets-heading" className="mb-3 text-lg font-semibold">
            Saved datasets
          </h2>
          {isLoading && (
            <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Loading datasets…
            </div>
          )}
          {loadError && <ErrorMessage message={loadError} />}
          {!isLoading && !loadError && datasets.length === 0 && (
            <div className="rounded-xl border border-dashed bg-card p-8 text-center">
              <Database className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No datasets yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a dataset together with its first test case.
              </p>
            </div>
          )}
          {!isLoading && !loadError && datasets.length > 0 && (
            <ul className="space-y-3">
              {datasets.map((dataset) => (
                <li key={dataset.id}>
                  <Link
                    to={`/datasets/${dataset.id}`}
                    className="block rounded-xl border bg-card p-5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold">{dataset.name}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {dataset.description || "No description"}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {dataset.test_case_count} {dataset.test_case_count === 1 ? "case" : "cases"}
                      </Badge>
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground">
                      Updated {formatDate(dataset.updated_at)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="create-dataset-heading">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>
                <h2 id="create-dataset-heading">Create dataset</h2>
              </CardTitle>
              <CardDescription>
                Every dataset starts with one complete test case.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="dataset-name" className="text-sm font-medium">Name</label>
                <Input
                  id="dataset-name"
                  form="create-dataset-form"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="dataset-description" className="flex items-center justify-between text-sm font-medium">
                  Description
                  <span className="text-xs font-normal text-muted-foreground">Optional</span>
                </label>
                <Textarea
                  id="dataset-description"
                  form="create-dataset-form"
                  className="min-h-20 font-sans"
                  value={description}
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div className="border-t pt-5">
                <div className="mb-4 flex items-center gap-2">
                  <Plus className="size-4" />
                  <h3 className="font-semibold">First test case</h3>
                </div>
                <TestCaseForm
                  formId="create-dataset-form"
                  submitLabel="Create dataset"
                  busy={isCreating}
                  error={formError}
                  onSubmit={handleCreate}
                />
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="flex gap-2" role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </Alert>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
