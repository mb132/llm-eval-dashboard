import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import {
  getEvaluationOptions,
  previewEvaluation,
  startEvaluation,
  type EvaluationConfiguration,
  type EvaluationOptions,
  type EvaluationPreview,
} from "@/api/evaluations"
import { listModels, type ModelConfiguration } from "@/api/models"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { OptionList, SelectableRow } from "@/components/ui/option-list"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { StepPanel } from "@/components/ui/step-panel"
import { formatInt } from "@/lib/format"

const breadcrumbs = [{ label: "Runs", to: "/evaluations/history" }, { label: "new" }]
const steps = ["Models", "Prompt versions", "Dataset", "Repetitions"]

export function EvaluationPage() {
  const navigate = useNavigate()
  const [options, setOptions] = useState<EvaluationOptions | null>(null)
  const [metadata, setMetadata] = useState<ModelConfiguration[]>([])
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [selectedPromptVersionIds, setSelectedPromptVersionIds] = useState<string[]>([])
  const [selectedDatasetId, setSelectedDatasetId] = useState("")
  const [repetitions, setRepetitions] = useState("1")
  const [preview, setPreview] = useState<{ key: string; result: EvaluationPreview } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const generation = useRef(0)
  const mounted = useRef(true)
  const startRequest = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      startRequest.current += 1
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.allSettled([getEvaluationOptions(), listModels()]).then(([optionResult, modelResult]) => {
      if (!active) return
      if (optionResult.status === "fulfilled") {
        setOptions(optionResult.value)
        if (optionResult.value.models.length === 1) setSelectedModelIds([optionResult.value.models[0].id])
      } else {
        setLoadError(errorMessage(optionResult.reason, "Could not load evaluation options."))
      }
      if (modelResult.status === "fulfilled") {
        setMetadata(modelResult.value)
        setMetadataError(null)
      } else {
        setMetadataError("Model availability and pricing metadata could not be loaded. Pricing is unknown where no price warning is provided.")
      }
      setIsLoading(false)
    })
    return () => { active = false }
  }, [loadAttempt])

  const models = useMemo(() => {
    const available = (options?.models ?? []).map((model) => {
      const detail = metadata.find((entry) => String(entry.id) === model.id)
      return {
        ...model, disabled: false, reason: null as string | null,
        price: model.pricing_stale || detail?.pricing?.stale ? "stale price" : model.pricing_unavailable || (detail && !detail.pricing) ? "no price" : detail?.pricing ? "priced" : "price unknown"
      }
    })
    for (const detail of metadata) {
      if (!available.some((model) => model.id === String(detail.id))) {
        available.push({
          id: String(detail.id), name: detail.display_name, model_name: detail.model_name,
          provider: detail.provider.kind, disabled: true,
          reason: detail.unavailable_reason ?? (detail.active ? "Not available for evaluation." : "Inactive model."),
          price: detail.pricing?.stale ? "stale price" : detail.pricing ? "priced" : "no price"
        })
      }
    }
    return available
  }, [options, metadata])
  const promptGroups = useMemo(() => {
    const groups = new Map<string, EvaluationOptions["prompt_versions"]>()
    for (const version of options?.prompt_versions ?? []) {
      const versions = groups.get(version.prompt_id) ?? []
      versions.push(version)
      groups.set(version.prompt_id, versions)
    }
    return [...groups.values()]
  }, [options])
  const configuration: EvaluationConfiguration = {
    model_ids: selectedModelIds, prompt_version_ids: selectedPromptVersionIds,
    dataset_id: selectedDatasetId, repetitions: Number(repetitions),
  }
  const selectionKey = JSON.stringify(configuration)
  const complete = selectedModelIds.length > 0 && selectedPromptVersionIds.length > 0 && Boolean(selectedDatasetId)
    && Number.isInteger(configuration.repetitions) && configuration.repetitions >= 1 && configuration.repetitions <= 5
  const testCases = options?.datasets.find((dataset) => dataset.id === selectedDatasetId)?.test_case_count ?? 0
  const total = selectedModelIds.length * selectedPromptVersionIds.length * testCases * Number(repetitions)
  const valid = complete && preview?.key === selectionKey && !isPreviewing && !previewError

  useEffect(() => {
    if (!complete) return
    let active = true
    const currentGeneration = generation.current
    const timer = window.setTimeout(() => {
      setIsPreviewing(true)
      previewEvaluation(JSON.parse(selectionKey) as EvaluationConfiguration).then((result) => {
        if (active && generation.current === currentGeneration) setPreview({ key: selectionKey, result })
      }).catch((error: unknown) => {
        if (active && generation.current === currentGeneration) setPreviewError(errorMessage(error, "Could not validate the configuration."))
      }).finally(() => {
        if (active && generation.current === currentGeneration) setIsPreviewing(false)
      })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [complete, selectionKey, previewAttempt])

  function change(callback: () => void) {
    generation.current += 1
    setPreview(null)
    setPreviewError(null)
    setStartError(null)
    setIsPreviewing(false)
    callback()
  }
  function toggle(id: string, selected: string[], update: (ids: string[]) => void) {
    change(() => update(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]))
  }
  async function handleStart() {
    if (!valid || !preview || isStarting) return
    setIsStarting(true)
    setStartError(null)
    const request = ++startRequest.current
    try {
      const result = await startEvaluation(JSON.parse(preview.key) as EvaluationConfiguration)
      if (!mounted.current || request !== startRequest.current) return
      navigate(`/evaluations/${result.id}`)
    } catch (error) {
      if (!mounted.current || request !== startRequest.current) return
      setStartError(errorMessage(error, "Could not start the evaluation."))
      setIsStarting(false)
    }
  }
  const status = valid ? "✓ valid" : previewError ? "✕ invalid" : complete ? "Validating…" : "Incomplete"
  const validationMessage = valid
    ? "Configuration valid"
    : isPreviewing
      ? "Validating configuration…"
      : complete && !previewError
        ? "Waiting to validate configuration…"
        : !complete
          ? "Choose models, prompt versions and a dataset to start."
          : null
  const empty = (title: string, to: string, label: string) => <EmptyState title={title} action={<LinkText to={to}>{label}</LinkText>} />

  return (
    <PageFrame breadcrumbs={breadcrumbs} mobileTitle="New evaluation">
      <PageHeader
        title="New evaluation"
        description="Combine models, immutable prompt versions, and one reusable dataset."
      />
      {isLoading ? (
        <div className="space-y-5">
          {steps.map((title, index) => <StepPanel key={title} step={index + 1} title={title} padded={false}><LoadingState
            label={index === 0 ? "Loading evaluation options…" : `Loading ${title.toLowerCase()}…`}
          /></StepPanel>)}
        </div>
      ) : loadError || !options ? (
        <ErrorState
          message={loadError ?? "Could not load evaluation options."}
          onRetry={() => { setLoadError(null); setIsLoading(true); setLoadAttempt((value) => value + 1) }}
        />
      ) : (
        <>
          <a
            href="#run-summary"
            className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-4 py-3 font-mono text-data focus-visible:outline-2 focus-visible:outline-ring xl:hidden"
          >
            {status} · {selectedModelIds.length} × {selectedPromptVersionIds.length} × {testCases} × {repetitions} · {formatInt(total)} req
          </a>
          <form
            className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"
            onSubmit={(event) => { event.preventDefault(); void handleStart() }}
          >
            <div className="min-w-0 space-y-5">
              <StepPanel
                step={1}
                title="Models"
                caption="One or more"
                count={`${selectedModelIds.length} of ${options.models.length} runnable`}
                padded={false}
                disabled={isStarting}
                actions={<Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="max-md:min-h-11"
                  disabled={!options.models.length}
                  onClick={() => change(() => setSelectedModelIds(options.models.map((model) => model.id)))}
                >Select all</Button>}
              >
                {options.models.length === 0 && empty("No runnable models. Add one in Models.", "/models", "Add a model")}
                <OptionList embedded>
                  {models.map((model) => <SelectableRow
                    key={model.id}
                    name="models"
                    value={model.id}
                    checked={selectedModelIds.includes(model.id)}
                    disabled={model.disabled}
                    label={model.name}
                    description={
                      <>
                        <span className="block font-mono [overflow-wrap:anywhere]">
                          {model.model_name} · {model.provider}
                        </span>
                        {model.reason && <span className="block [overflow-wrap:anywhere]">{model.reason}</span>}
                      </>
                    }
                    hint={
                      <span className={model.price === "priced" ? "text-success" : "text-warning"}>
                        {model.price === "priced" ? "✓" : "⚠"} {model.price}
                      </span>
                    }
                    onCheckedChange={() => toggle(model.id, selectedModelIds, setSelectedModelIds)}
                  />)}
                </OptionList>
              </StepPanel>
              <StepPanel
                step={2}
                title="Prompt versions"
                caption="Versions are immutable"
                count={`${selectedPromptVersionIds.length} of ${options.prompt_versions.length}`}
                padded={false}
                disabled={isStarting}
              >
                {!promptGroups.length ? empty("No prompt versions exist yet.", "/prompts", "Create a prompt") : promptGroups.map((versions) => (
                  <fieldset key={versions[0].prompt_id} className="min-w-0">
                    <legend
                      className="w-full bg-chrome px-4 py-2 text-overline uppercase text-fg-muted [overflow-wrap:anywhere]"
                    >{versions[0].prompt_name}</legend>
                    <OptionList embedded>{versions.map((version) => <SelectableRow
                      key={version.id}
                      name="prompt_versions"
                      value={version.id}
                      checked={selectedPromptVersionIds.includes(version.id)}
                      label={
                        <>
                          {version.prompt_name}{" "}
                          <span className="font-mono text-data text-fg-muted">v{version.version_number}</span>
                        </>
                      }
                      description={
                        <>
                          <span className="block truncate font-mono" title={version.content_preview}>
                            {version.content_preview}
                          </span>
                          {version.system_prompt_preview && (
                            <span className="block truncate font-mono" title={version.system_prompt_preview}>
                              System: {version.system_prompt_preview}
                            </span>
                          )}
                        </>
                      }
                      onCheckedChange={() => toggle(version.id, selectedPromptVersionIds, setSelectedPromptVersionIds)}
                    />)}</OptionList>
                  </fieldset>
                ))}
              </StepPanel>
              <StepPanel step={3} title="Dataset" caption="Exactly one" padded={false} disabled={isStarting}>
                {!options.datasets.length ? empty("No datasets exist yet.", "/datasets", "Create a dataset") : (
                  <OptionList embedded className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))]">
                    {options.datasets.map((dataset) => <SelectableRow
                      key={dataset.id}
                      type="radio"
                      name="dataset"
                      value={dataset.id}
                      label={dataset.name}
                      description={
                        <>
                          <span className="font-mono text-data">{formatInt(dataset.test_case_count)}</span>{" "}
                          <span className="text-fg-muted">cases</span>
                        </>
                      }
                      checked={selectedDatasetId === dataset.id}
                      onCheckedChange={() => change(() => setSelectedDatasetId(dataset.id))}
                    />)}
                  </OptionList>
                )}
              </StepPanel>
              <StepPanel step={4} title="Repetitions" disabled={isStarting}>
                <SegmentedControl
                  mode="radio"
                  label="Repetitions"
                  name="repetitions"
                  value={repetitions}
                  options={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }))}
                  onValueChange={(value) => change(() => setRepetitions(value))}
                />
                <p className="mt-2 text-caption text-fg-muted">Repeats every model × prompt × case combination.</p>
              </StepPanel>
            </div>
            <aside
              id="run-summary"
              className="min-w-0 xl:sticky xl:top-5 xl:self-start"
              aria-labelledby="run-size-title"
            >
              <Card>
                <CardHeader>
                  <CardTitle id="run-size-title">Run size</CardTitle>
                  <Badge variant={valid ? "success" : previewError ? "destructive" : "secondary"}>{status}</Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <dl className="space-y-2">
                    <SummaryValue label="Models" value={formatInt(selectedModelIds.length)} />
                    <SummaryValue label="Prompt versions" value={`× ${formatInt(selectedPromptVersionIds.length)}`} />
                    <SummaryValue label="Test cases" value={`× ${formatInt(testCases)}`} />
                    <SummaryValue label="Repetitions" value={`× ${repetitions}`} />
                    <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
                      <dt className="text-caption text-fg-muted">Total requests</dt>
                      <dd className="font-mono text-metric-lg">{formatInt(total)}</dd>
                    </div>
                  </dl>
                  {metadataError && <Alert variant="warning"><p className="min-w-0 [overflow-wrap:anywhere]">{metadataError}</p></Alert>}
                  {models.filter((model) => selectedModelIds.includes(model.id) && model.price !== "priced").map((model) => (
                    <Alert key={model.id} variant="warning">
                      <p className="min-w-0 [overflow-wrap:anywhere]">
                        {pricingWarning(model.name, model.price, selectedPromptVersionIds.length * testCases * Number(repetitions))}{" "}
                        <LinkText to="/models">Add pricing</LinkText>
                      </p>
                    </Alert>
                  ))}
                  <div role="status" className="text-caption text-fg-muted">{validationMessage}</div>
                  {previewError && <ErrorState
                    message={previewError}
                    onRetry={() => change(() => setPreviewAttempt((value) => value + 1))}
                  />}
                  {startError && <ErrorState message={startError} />}
                  <Button type="submit" size="lg" className="w-full max-md:h-12" disabled={!valid || isStarting}>{isStarting ? "Starting…" : "Start evaluation"}</Button>
                  <p className="text-caption text-fg-muted">The run stores a snapshot of these models, prompt versions and cases.</p>
                </CardContent>
              </Card>
            </aside>
          </form>
        </>
      )}
    </PageFrame>
  )
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-mono text-data">{value}</dd>
    </div>
  )
}
function LinkText({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link
    to={to}
    className="inline-flex min-h-11 items-center text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
  >{children}</Link>
}
function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
function pricingWarning(name: string, price: string, requests: number) {
  if (price === "stale price") {
    return `${name} has a stale price. This run will use the last saved estimate.`
  }
  if (price === "no price") {
    return `${name} has no price. Cost for its ${formatInt(requests)} requests will show as unpriced unless pricing refresh succeeds.`
  }
  return `${name} has unknown pricing. A cost estimate may be unavailable.`
}
