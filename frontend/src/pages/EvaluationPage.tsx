import {
  AlertCircle,
  CheckCircle2,
  Layers3,
  LoaderCircle,
  RefreshCw,
} from "lucide-react"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"

import {
  getEvaluationOptions,
  previewEvaluation,
  startEvaluation,
  type EvaluationConfiguration,
  type EvaluationOptions,
  type EvaluationPreview,
} from "@/api/evaluations"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export function EvaluationPage() {
  const navigate = useNavigate()
  const [options, setOptions] = useState<EvaluationOptions | null>(null)
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [selectedPromptVersionIds, setSelectedPromptVersionIds] = useState<
    string[]
  >([])
  const [selectedDatasetId, setSelectedDatasetId] = useState("")
  const [repetitions, setRepetitions] = useState("1")
  const [preview, setPreview] = useState<EvaluationPreview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getEvaluationOptions()
      .then((result) => {
        if (!active) return
        setOptions(result)
        if (result.models.length === 1) setSelectedModelIds([result.models[0].id])
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load evaluation options.",
          )
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const promptGroups = useMemo(() => {
    const groups = new Map<string, EvaluationOptions["prompt_versions"]>()
    for (const version of options?.prompt_versions ?? []) {
      const versions = groups.get(version.prompt_id) ?? []
      versions.push(version)
      groups.set(version.prompt_id, versions)
    }
    return [...groups.values()]
  }, [options])

  const repetitionCount = Number(repetitions)
  const configurationIsComplete =
    selectedModelIds.length > 0 &&
    selectedPromptVersionIds.length > 0 &&
    Boolean(selectedDatasetId) &&
    Number.isInteger(repetitionCount) &&
    repetitionCount >= 1 &&
    repetitionCount <= 5

  function selectionChanged(callback: () => void) {
    callback()
    setPreview(null)
    setPreviewError(null)
    setStartError(null)
  }

  async function handleStart() {
    if (!preview || isStarting) return
    setIsStarting(true)
    setStartError(null)
    try {
      const evaluation = await startEvaluation({
        model_ids: preview.model_ids,
        prompt_version_ids: preview.prompt_version_ids,
        dataset_id: preview.dataset_id,
        repetitions: preview.repetitions,
      })
      navigate(`/evaluations/${evaluation.id}`)
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : "Could not start the evaluation.",
      )
      setIsStarting(false)
    }
  }

  function toggleSelection(
    id: string,
    selectedIds: string[],
    setSelectedIds: (ids: string[]) => void,
  ) {
    selectionChanged(() =>
      setSelectedIds(
        selectedIds.includes(id)
          ? selectedIds.filter((selectedId) => selectedId !== id)
          : [...selectedIds, id],
      ),
    )
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!configurationIsComplete) return
    const configuration: EvaluationConfiguration = {
      model_ids: selectedModelIds,
      prompt_version_ids: selectedPromptVersionIds,
      dataset_id: selectedDatasetId,
      repetitions: repetitionCount,
    }
    setIsPreviewing(true)
    setPreviewError(null)
    try {
      setPreview(await previewEvaluation(configuration))
    } catch (error) {
      setPreview(null)
      setPreviewError(
        error instanceof Error
          ? error.message
          : "Could not validate the configuration.",
      )
    } finally {
      setIsPreviewing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading evaluation options…
      </div>
    )
  }

  if (loadError || !options) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader />
        <ErrorMessage message={loadError ?? "Could not load evaluation options."} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader />
      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
        onSubmit={handlePreview}
        noValidate
      >
        <div className="space-y-6">
          <SelectionCard
            step="1"
            title="Models"
            description="Choose one or more models to compare."
          >
            {options.models.length === 0 ? (
              <EmptySelection>
                No active runnable models are available. Add or activate one on
                the <LinkText to="/models">Models page</LinkText> before creating
                an evaluation.
              </EmptySelection>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {options.models.map((model) => (
                  <label
                    key={model.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-4 transition-colors has-[:checked]:border-foreground has-[:checked]:bg-muted"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-foreground"
                      checked={selectedModelIds.includes(model.id)}
                      onChange={() =>
                        toggleSelection(
                          model.id,
                          selectedModelIds,
                          setSelectedModelIds,
                        )
                      }
                    />
                    <span>
                      <span className="block font-medium">{model.name}</span>
                      <span className="mt-1 block font-mono text-xs text-muted-foreground">
                        {model.model_name}
                      </span>
                      <span className="mt-1 block text-xs uppercase tracking-wide text-muted-foreground">
                        {model.provider}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </SelectionCard>

          <SelectionCard
            step="2"
            title="Prompt versions"
            description="Select every immutable prompt version to compare."
          >
            {promptGroups.length === 0 ? (
              <EmptySelection>
                No prompt versions exist yet.{" "}
                <LinkText to="/prompts">Create a prompt</LinkText> first.
              </EmptySelection>
            ) : (
              <div className="space-y-4">
                {promptGroups.map((versions) => (
                  <fieldset key={versions[0].prompt_id} className="space-y-2">
                    <legend className="font-medium">{versions[0].prompt_name}</legend>
                    {versions.map((version) => (
                      <label
                        key={version.id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-4 transition-colors has-[:checked]:border-foreground has-[:checked]:bg-muted"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 size-4 accent-foreground"
                          checked={selectedPromptVersionIds.includes(version.id)}
                          onChange={() =>
                            toggleSelection(
                              version.id,
                              selectedPromptVersionIds,
                              setSelectedPromptVersionIds,
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">
                            Version {version.version_number}
                          </span>
                          <span className="mt-1 block break-words text-sm text-muted-foreground">
                            {version.content_preview}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
          </SelectionCard>

          <SelectionCard
            step="3"
            title="Dataset"
            description="Choose the reusable test cases for this evaluation."
          >
            {options.datasets.length === 0 ? (
              <EmptySelection>
                No datasets exist yet.{" "}
                <LinkText to="/datasets">Create a dataset</LinkText> first.
              </EmptySelection>
            ) : (
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Dataset</legend>
                {options.datasets.map((dataset) => (
                  <label
                    key={dataset.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-4 transition-colors has-[:checked]:border-foreground has-[:checked]:bg-muted"
                  >
                    <input
                      type="radio"
                      name="dataset"
                      className="mt-1 size-4 accent-foreground"
                      checked={selectedDatasetId === dataset.id}
                      onChange={() =>
                        selectionChanged(() => setSelectedDatasetId(dataset.id))
                      }
                    />
                    <span>
                      <span className="block font-medium">{dataset.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {dataset.test_case_count}{" "}
                        {dataset.test_case_count === 1 ? "test case" : "test cases"}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </SelectionCard>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>
                <h2>Configuration</h2>
              </CardTitle>
              <CardDescription>
                Review the expected run size before starting the evaluation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="repetitions" className="text-sm font-medium">
                  Repetitions
                </label>
                <Input
                  id="repetitions"
                  type="number"
                  min={1}
                  max={5}
                  value={repetitions}
                  onChange={(event) =>
                    selectionChanged(() =>
                      setRepetitions(event.currentTarget.value),
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Repeats every model, prompt, and test-case combination up to five
                  times.
                </p>
              </div>

              <SelectionSummary
                models={selectedModelIds.length}
                prompts={selectedPromptVersionIds.length}
                datasetSelected={Boolean(selectedDatasetId)}
              />

              {previewError && <ErrorMessage message={previewError} />}
              <Button
                type="submit"
                className="w-full"
                disabled={!configurationIsComplete || isPreviewing}
              >
                {isPreviewing ? (
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                {isPreviewing ? "Reviewing…" : "Review configuration"}
              </Button>
            </CardContent>
          </Card>

          {preview && (
            <PreviewCard
              preview={preview}
              isStarting={isStarting}
              startError={startError}
              onStart={handleStart}
            />
          )}
        </aside>
      </form>
    </div>
  )
}

function PageHeader() {
  return (
    <header className="space-y-3">
      <Badge variant="secondary">Evaluation setup</Badge>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Configure evaluation
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Combine models, immutable prompt versions, and one reusable dataset.
        </p>
      </div>
    </header>
  )
}

function SelectionCard({
  step,
  title,
  description,
  children,
}: {
  step: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-start gap-3">
          <Badge>{step}</Badge>
          <div>
            <CardTitle>
              <h2>{title}</h2>
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function EmptySelection({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
      {children}
    </p>
  )
}

function LinkText({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
    >
      {children}
    </Link>
  )
}

function SelectionSummary({
  models,
  prompts,
  datasetSelected,
}: {
  models: number
  prompts: number
  datasetSelected: boolean
}) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-center">
      <SummaryValue label="Models" value={models} />
      <SummaryValue label="Prompts" value={prompts} />
      <SummaryValue label="Dataset" value={datasetSelected ? 1 : 0} />
    </dl>
  )
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  )
}

function PreviewCard({
  preview,
  isStarting,
  startError,
  onStart,
}: {
  preview: EvaluationPreview
  isStarting: boolean
  startError: string | null
  onStart: () => void
}) {
  return (
    <Card className="border-green-200 bg-green-50 shadow-sm" aria-live="polite">
      <CardHeader>
        <div className="flex items-center gap-2 text-green-800">
          <CheckCircle2 className="size-5" />
          <CardTitle>
            <h2>Configuration valid</h2>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-3 text-sm">
          <PreviewValue
            label="Model × prompt combinations"
            value={preview.combination_count}
          />
          <PreviewValue label="Test cases" value={preview.test_case_count} />
          <PreviewValue label="Repetitions" value={preview.repetitions} />
          <div className="flex items-center justify-between border-t border-green-200 pt-3 text-base font-semibold">
            <dt className="flex items-center gap-2">
              <Layers3 className="size-4" />
              Total model requests
            </dt>
            <dd>{preview.total_requests}</dd>
          </div>
        </dl>
        {startError && <ErrorMessage message={startError} />}
        <Button
          type="button"
          className="w-full"
          disabled={isStarting}
          onClick={onStart}
        >
          {isStarting && <LoaderCircle className="mr-2 size-4 animate-spin" />}
          {isStarting ? "Starting evaluation…" : "Start evaluation"}
        </Button>
      </CardContent>
    </Card>
  )
}

function PreviewValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt>{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  )
}
