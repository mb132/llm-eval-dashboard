import { AlertCircle, LoaderCircle, MessageSquareText, Play } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"

import { listModels, type ModelConfiguration, type Provider } from "@/api/models"
import { runPlaygroundPrompt, type PlaygroundResult } from "@/api/playground"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

const PROVIDER_LABELS: Record<Provider, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openai_compatible: "OpenAI-compatible API",
  custom: "Custom endpoint",
}

export function PlaygroundPage() {
  const [models, setModels] = useState<ModelConfiguration[]>([])
  const [selectedModelId, setSelectedModelId] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [prompt, setPrompt] = useState("")
  const [result, setResult] = useState<PlaygroundResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [running, setRunning] = useState(false)

  const runnableModels = useMemo(
    () => models.filter((model) => model.active && (model.provider as any).kind !== "custom"),
    [models],
  )
  const customModelCount = models.filter(
    (model) => model.active && (model.provider as any).kind === "custom",
  ).length
  const selectedModel = runnableModels.find(
    (model) => String(model.id) === selectedModelId,
  )

  const loadModels = useCallback(async () => {
    setLoadingModels(true)
    setError(null)
    try {
      const configuredModels = await listModels()
      setModels(configuredModels)
      const firstAvailable = configuredModels.find(
        (model) => model.active && (model.provider as any).kind !== "custom" && !unavailableReason(model),
      )
      setSelectedModelId(firstAvailable ? String(firstAvailable.id) : "")
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    } finally {
      setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selectedModel || !prompt.trim()) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      setResult(await runPlaygroundPrompt({
        model_id: selectedModel.id,
        prompt,
        system_prompt: systemPrompt.trim() || null,
      }))
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    } finally {
      setRunning(false)
    }
  }

  const selectionUnavailable = !selectedModel || Boolean(unavailableReason(selectedModel))

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-3">
        <Badge variant="secondary">One-shot generation</Badge>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Playground</h1>
          <p className="mt-2 text-muted-foreground">
            Send any text prompt to one of your active configured models.
          </p>
        </div>
      </header>

      {error && <ErrorBanner message={error} />}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Prompt a model</CardTitle>
          <CardDescription>
            Saved model parameters are applied automatically. Prompts and replies are not stored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={submit}>
            <Field label="Model" htmlFor="playground-model">
              <Select
                id="playground-model"
                value={selectedModelId}
                disabled={loadingModels || runnableModels.length === 0}
                onChange={(event) => setSelectedModelId(event.target.value)}
              >
                <option value="">
                  {loadingModels ? "Loading models…" : "Select a model"}
                </option>
                {runnableModels.map((model) => {
                  const reason = unavailableReason(model)
                  return (
                    <option key={model.id} value={model.id} disabled={Boolean(reason)}>
                      {model.display_name} · {model.model_name}
                      {reason ? ` — ${reason}` : ""}
                    </option>
                  )
                })}
              </Select>
            </Field>

            {runnableModels.length === 0 && !loadingModels && (
              <Notice>No active runnable models are configured. Add or activate one on the Models page.</Notice>
            )}
            {customModelCount > 0 && (
              <Notice>
                Custom endpoints are not listed because they do not define a request protocol.
              </Notice>
            )}

            <Field
              label="System prompt"
              htmlFor="system-prompt"
              hint="Optional instructions applied before the user prompt."
            >
              <Textarea
                id="system-prompt"
                rows={3}
                className="font-sans"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder="You are a concise and helpful assistant."
              />
            </Field>

            <Field label="Prompt" htmlFor="user-prompt">
              <Textarea
                id="user-prompt"
                required
                rows={7}
                className="font-sans"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What would you like to ask?"
              />
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <p className="text-xs text-muted-foreground">
                {selectedModel
                  ? `${PROVIDER_LABELS[(selectedModel.provider as any).kind as Provider]} · ${selectedModel.model_name}`
                  : "Choose an available model to run the prompt."}
              </p>
              <Button type="submit" disabled={running || selectionUnavailable || !prompt.trim()}>
                {running ? (
                  <><LoaderCircle className="mr-2 size-4 animate-spin" />Running…</>
                ) : (
                  <><Play className="mr-2 size-4" />Run prompt</>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {result && <PlaygroundResultCard result={result} />}
    </section>
  )
}

function PlaygroundResultCard({ result }: { result: PlaygroundResult }) {
  return (
    <Card className="shadow-sm" aria-live="polite">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Reply</CardTitle>
            <CardDescription className="mt-1">
              {result.display_name} · {PROVIDER_LABELS[result.provider]} · {result.model_name}
            </CardDescription>
          </div>
          <Badge><MessageSquareText className="mr-1 size-3" />Complete</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-5 font-sans text-base leading-relaxed">
          {result.response}
        </pre>
        <dl className="grid grid-cols-2 gap-3 border-t pt-5 sm:grid-cols-5">
          <Metric label="Latency" value={`${result.latency_ms.toLocaleString()} ms`} />
          <Metric label="Input tokens" value={formatMetric(result.input_tokens)} />
          <Metric label="Output tokens" value={formatMetric(result.output_tokens)} />
          <Metric label="Total tokens" value={formatMetric(result.total_tokens)} />
          <Metric label="Finish reason" value={result.finish_reason ?? "Unavailable"} />
        </dl>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-semibold">{value}</dd>
    </div>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">{children}</p>
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  )
}

function unavailableReason(model: ModelConfiguration): string | null {
  const provider = model.provider as any
  if (provider.kind === "openai_compatible" && !provider.base_url) return "Base URL required"
  if (provider.api_key_requirement === "required" && !provider.has_api_key) {
    return "Credentials unavailable"
  }
  return null
}

function formatMetric(value: number | null) {
  return value === null ? "Unavailable" : value.toLocaleString()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}
