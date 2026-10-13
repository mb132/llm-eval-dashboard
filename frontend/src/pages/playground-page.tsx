import { Info, LoaderCircle, MessageSquareText, Play } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Link, useLocation } from "react-router-dom"

import { listModels, type ModelConfiguration } from "@/api/models"
import { runPlaygroundPrompt, type PlaygroundResult } from "@/api/playground"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { InsetPane } from "@/components/ui/inset-pane"
import { MetricCell } from "@/components/ui/metric-strip"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime, formatInt, formatTokens, formatUsd } from "@/lib/format"

type RequestSnapshot = {
  model: ModelConfiguration
  input: Parameters<typeof runPlaygroundPrompt>[0]
}

function NotSavedNotice() {
  return (
    <Badge variant="info" className="h-auto min-h-5 max-w-full whitespace-normal py-1 [overflow-wrap:anywhere]">
      <Info aria-hidden="true" className="size-3.5 shrink-0" />
      Not saved · replies never appear in runs
    </Badge>
  )
}

export function PlaygroundPage() {
  const { key: locationKey } = useLocation()
  const [models, setModels] = useState<ModelConfiguration[]>([])
  const [selectedModelId, setSelectedModelId] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [prompt, setPrompt] = useState("")
  const [result, setResult] = useState<PlaygroundResult | null>(null)
  const [request, setRequest] = useState<RequestSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [running, setRunning] = useState(false)
  const mounted = useRef(false)
  const modelLoadId = useRef(0)
  const requestId = useRef(0)
  const runningRef = useRef(false)

  const activeModels = useMemo(
    () => models.filter((model) => model.active && model.provider.kind !== "custom"),
    [models],
  )
  const hasRunnableModel = activeModels.some((model) => !unavailableReason(model))
  const customModelCount = models.filter((model) => model.active && model.provider.kind === "custom").length
  const selectedModel = activeModels.find((model) => String(model.id) === selectedModelId)
  const canRun = !loadingModels && !modelError && selectedModel && !unavailableReason(selectedModel) && Boolean(prompt.trim())

  const loadModels = useCallback(async () => {
    const loadId = ++modelLoadId.current
    setLoadingModels(true)
    setModelError(null)
    try {
      const configuredModels = await listModels()
      if (!mounted.current || loadId !== modelLoadId.current) return
      setModels(configuredModels)
      const firstAvailable = configuredModels.find(
        (model) => model.active && model.provider.kind !== "custom" && !unavailableReason(model),
      )
      setSelectedModelId(firstAvailable ? String(firstAvailable.id) : "")
    } catch (caughtError) {
      if (mounted.current && loadId === modelLoadId.current) setModelError(errorMessage(caughtError))
    } finally {
      if (mounted.current && loadId === modelLoadId.current) setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    runningRef.current = false
    setRunning(false)
    setResult(null)
    setRequest(null)
    setError(null)
    void loadModels()
    return () => {
      mounted.current = false
      modelLoadId.current += 1
      requestId.current += 1
    }
  }, [loadModels, locationKey])

  async function run(snapshot: RequestSnapshot) {
    if (runningRef.current || !mounted.current) return
    runningRef.current = true
    const currentRequestId = ++requestId.current
    setRunning(true)
    setRequest(snapshot)
    setError(null)
    setResult(null)
    try {
      const reply = await runPlaygroundPrompt(snapshot.input)
      if (mounted.current && currentRequestId === requestId.current) setResult(reply)
    } catch (caughtError) {
      if (mounted.current && currentRequestId === requestId.current) setError(errorMessage(caughtError))
    } finally {
      if (mounted.current && currentRequestId === requestId.current) {
        runningRef.current = false
        setRunning(false)
      }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    runCurrentPrompt()
  }

  function runCurrentPrompt() {
    if (!canRun || !selectedModel || runningRef.current) return
    void run({
      model: { ...selectedModel, pricing: selectedModel.pricing ? { ...selectedModel.pricing } : null },
      input: { model_id: selectedModel.id, prompt, system_prompt: systemPrompt.trim() || null },
    })
  }

  return (
    <PageFrame breadcrumbs={[{ label: "Playground" }]} mobileTitle="Playground" actions={<NotSavedNotice />}>
      <PageHeader
        title="Playground"
        description="Try one prompt against an active model. Saved model parameters are applied."
        metadata={<div className="md:hidden"><NotSavedNotice /></div>}
      />
      <div className="flex min-w-0 flex-wrap items-start gap-5">
        <Card className="min-w-0 flex-[1_1_460px]" role="region" aria-labelledby="playground-prompt-title">
          <CardHeader><CardTitle id="playground-prompt-title">Prompt</CardTitle></CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <Field
                label="Model"
                htmlFor="playground-model"
                hint={selectedModel ? (
                  <span className="font-mono [overflow-wrap:anywhere]">
                    {selectedModel.provider.display_name} · {selectedModel.provider.kind}
                    {!validPricing(selectedModel) && <span className="text-warning"> · ⚠ no price</span>}
                    {selectedModel.pricing?.stale && (
                      <span className="block text-warning">{stalePriceCaption(selectedModel)}</span>
                    )}
                  </span>
                ) : "Choose an available model to run the prompt."}
              >
                <Select
                  id="playground-model"
                  value={selectedModelId}
                  disabled={running || loadingModels || Boolean(modelError) || activeModels.length === 0}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  <option value="">{loadingModels ? "Loading models…" : "Select a model"}</option>
                  {activeModels.map((model) => {
                    const reason = unavailableReason(model)
                    return (
                      <option key={model.id} value={model.id} disabled={Boolean(reason)}>
                        {model.display_name} · {model.model_name}{reason ? ` — ${reason}` : ""}
                      </option>
                    )
                  })}
                </Select>
              </Field>
              {loadingModels && <LoadingState label="Loading models…" />}
              {modelError && <ErrorState message={modelError} onRetry={() => void loadModels()} />}
              {!loadingModels && !modelError && !hasRunnableModel && (
                <EmptyState
                  title="No runnable model. Add one in Models."
                  action={<Link to="/models" className={buttonVariants({ variant: "outline", className: "max-md:h-11" })}>Add model</Link>}
                />
              )}
              {customModelCount > 0 && (
                <p className="text-caption text-fg-muted">Custom endpoints are not listed because they do not define a request protocol.</p>
              )}
              <Field label="System prompt" htmlFor="system-prompt" optional>
                <Textarea
                  id="system-prompt"
                  rows={3}
                  className="font-mono max-md:min-h-11 [overflow-wrap:anywhere]"
                  disabled={running}
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  placeholder="You are a concise and helpful assistant."
                />
              </Field>
              <Field label="Prompt" htmlFor="user-prompt" hint="Ctrl/Cmd+Enter to run.">
                <Textarea
                  id="user-prompt"
                  required
                  rows={7}
                  className="font-mono max-md:min-h-11 [overflow-wrap:anywhere]"
                  disabled={running}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      runCurrentPrompt()
                    }
                  }}
                  placeholder="What would you like to ask?"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" className="h-12 w-full md:h-9 md:w-auto" disabled={running || !canRun}>
                  {running ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Play aria-hidden="true" />}
                  {running ? "Running…" : "Run prompt"}
                </Button>
                <p className="text-caption text-fg-muted">One request. Nothing is stored.</p>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card className="min-w-0 flex-[1_1_460px]" role="region" aria-labelledby="playground-reply-title" aria-live="polite" aria-busy={running}>
          <CardHeader>
            <CardTitle id="playground-reply-title">Reply</CardTitle>
            {(result || request) && (
              <span className="min-w-0 max-w-full flex-1 font-mono text-data text-fg-muted [overflow-wrap:anywhere]">
                {result?.model_name ?? request?.model.model_name}
              </span>
            )}
            {running && <Badge variant="info" className="shrink-0">● running</Badge>}
            {error && <Badge variant="destructive" className="shrink-0">✕ failed</Badge>}
            {result && <Badge variant="success" className="shrink-0">✓ complete</Badge>}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!request && <EmptyState title="Run a prompt to see the reply here." icon={<MessageSquareText />} />}
            {running && <LoadingState label={`Waiting for ${request?.model.display_name}…`} />}
            {error && request && (
              <Alert variant="destructive" className="flex-col">
                <span className="whitespace-pre-wrap font-mono text-data [overflow-wrap:anywhere]">✕ {error}</span>
                <p className="[overflow-wrap:anywhere]">
                  {request.model.display_name} could not complete the request. Nothing was stored.
                  Try again with the same request, or pick another model and run the prompt.
                </p>
                <Button type="button" variant="outline" className="max-md:h-11" disabled={running} onClick={() => void run(request)}>Try again</Button>
              </Alert>
            )}
            {result && request && <ReplyDetails result={result} model={request.model} />}
          </CardContent>
        </Card>
      </div>
    </PageFrame>
  )
}

function ReplyDetails({ result, model }: { result: PlaygroundResult; model: ModelConfiguration }) {
  const pricing = validPricing(model)
  const cost = pricing && finiteCount(result.input_tokens) && finiteCount(result.output_tokens)
    ? (result.input_tokens * pricing.input + result.output_tokens * pricing.output) / 1_000_000
    : null
  const hasTokenUsage = finiteCount(result.input_tokens) && finiteCount(result.output_tokens)

  return (
    <>
      <InsetPane label="Response" className="min-h-24 rounded-md border border-line-strong [&>div:last-child]:text-[14px] [&>div:last-child]:leading-[22px]">
        {result.response}
      </InsetPane>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3 [&>div>div:nth-child(2)]:text-metric-md">
        <MetricCell label="Latency" value={formatInt(result.latency_ms)} unit="ms" />
        <MetricCell
          label="Tokens in / out"
          value={`${formatTokens(result.input_tokens)} / ${formatTokens(result.output_tokens)}`}
          subValue={!hasTokenUsage ? "Some token usage was not reported" : undefined}
        />
        <MetricCell label="Total tokens" value={formatTokens(result.total_tokens)} subValue={result.total_tokens === null ? "Not reported by the provider" : undefined} />
        <MetricCell label="Finish reason" value={result.finish_reason ?? "—"} subValue={result.finish_reason === null ? "Not reported by the provider" : undefined} />
        <MetricCell
          className="col-span-2"
          label="Est. cost"
          value={pricing ? formatUsd(cost) : <span className="text-body text-warning">⚠ no price for this model · <Link to="/models" className="text-link hover:underline">Add pricing</Link></span>}
          subValue={pricing ? (
            <>
              {hasTokenUsage ? "Based on configured pricing" : "Input and output token usage required to estimate cost"}
              {model.pricing?.stale && (
                <span className="block text-warning">{stalePriceCaption(model)}</span>
              )}
            </>
          ) : "Configure pricing in Models to estimate cost."}
        />
      </div>
    </>
  )
}

function unavailableReason(model: ModelConfiguration): string | null {
  if (typeof model.runnable === "boolean") return model.runnable ? null : model.unavailable_reason || "Model unavailable"
  if (model.unavailable_reason) return model.unavailable_reason
  if (model.provider.kind === "openai_compatible" && !model.provider.base_url) return "Base URL required"
  if (model.provider.api_key_requirement === "required" && !model.provider.has_api_key) return "Credentials unavailable"
  return null
}

function finiteCount(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function stalePriceCaption(model: ModelConfiguration): string {
  const fetchedAt = formatDateTime(model.pricing?.fetched_at ?? model.pricing_fetched_at)
  return `⚠ stale price · ${fetchedAt === "—" ? "fetch date unavailable" : `fetched ${fetchedAt}`}`
}

function validPricing(model: ModelConfiguration): { input: number; output: number } | null {
  if (!model.pricing) return null
  const input = model.pricing.input_usd_per_million_tokens
  const output = model.pricing.output_usd_per_million_tokens
  if (formatUsd(input) === "—" || formatUsd(output) === "—") return null
  const inputRate = Number(input)
  const outputRate = Number(output)
  return inputRate >= 0 && outputRate >= 0 ? { input: inputRate, output: outputRate } : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}
