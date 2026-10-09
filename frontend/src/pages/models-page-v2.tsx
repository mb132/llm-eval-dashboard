import { KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"

import {
  createModel,
  deleteModel,
  listModels,
  updateModel,
  type ModelConfiguration,
  type ModelConfigurationInput,
  type PricingSelection,
  type Provider,
} from "@/api/models"
import {
  createProvider,
  deleteProvider,
  listProviders,
  type ProviderConfiguration,
  type ProviderConfigurationInput,
  type OpenRouterLimits,
  getOpenRouterLimits,
  refreshOpenRouterPrices,
} from "@/api/providers"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

const PROVIDERS: Provider[] = [
  "ollama",
  "openai",
  "openrouter",
  "anthropic",
  "gemini",
  "openai_compatible",
  "custom",
]
const LABELS: Record<Provider, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openai_compatible: "OpenAI-compatible API",
  custom: "Custom endpoint",
}

export function ModelsPage() {
  const [providers, setProviders] = useState<ProviderConfiguration[]>([])
  const [models, setModels] = useState<ModelConfiguration[]>([])
  const [limits, setLimits] = useState<Record<number, OpenRouterLimits>>({})
  const [providerDialog, setProviderDialog] = useState(false)
  const [modelDialog, setModelDialog] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelConfiguration | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const initialLoadStarted = useRef(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [nextProviders, nextModels] = await Promise.all([
        listProviders(),
        listModels(),
      ])
      setProviders(nextProviders)
      setModels(nextModels)
      const nextLimits = await Promise.all(nextProviders.filter((provider) => provider.kind === "openrouter").map(async (provider) => {
        try { return [provider.id, await getOpenRouterLimits(provider.id)] as const }
        catch { return [provider.id, { available: false, supported: true, fetched_at: null }] as const }
      }))
      setLimits(Object.fromEntries(nextLimits))
      setHasLoaded(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setIsLoading(false)
    }
  }, [])

  async function refreshPrices(providerId: number) {
    try {
      const result = await refreshOpenRouterPrices(providerId)
      setModels((current) => [
        ...current.filter((model) => model.provider.id !== providerId),
        ...result.models,
      ].sort((a, b) => a.id - b.id))
      if (!result.available) setError(result.message ?? "Could not refresh OpenRouter prices.")
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  useEffect(() => {
    if (initialLoadStarted.current) return
    initialLoadStarted.current = true
    void load()
  }, [load])

  async function removeProvider(provider: ProviderConfiguration) {
    if (!window.confirm(`Remove “${provider.display_name}”?`)) return
    try {
      await deleteProvider(provider.id)
      await load()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function removeModel(model: ModelConfiguration) {
    if (!window.confirm(`Remove “${model.display_name}”?`)) return
    try {
      await deleteModel(model.id)
      await load()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <section className="space-y-8" aria-busy={isLoading}>
      <div>
        <Badge variant="secondary">Configuration</Badge>
        <h1 className="mt-3 text-3xl font-semibold">Models</h1>
        <p className="mt-2 text-muted-foreground">
          Add a provider connection once, then reuse it for one or more models.
        </p>
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}

      <ProviderList
        providers={providers}
        limits={limits}
        isLoading={isLoading && !hasLoaded}
        onAdd={() => setProviderDialog(true)}
        onRemove={removeProvider}
        onRefreshPrices={refreshPrices}
      />
      <ModelList
        providersAvailable={providers.length > 0}
        models={models}
        isLoading={isLoading && !hasLoaded}
        onAdd={() => setModelDialog(true)}
        onEdit={setEditingModel}
        onRemove={removeModel}
      />

      <Dialog
        open={providerDialog}
        onOpenChange={setProviderDialog}
        title="Add provider"
        description="The API key is write-only and encrypted in the local database."
      >
        <ProviderForm
          onSaved={() => {
            setProviderDialog(false)
            void load()
          }}
        />
      </Dialog>
      <Dialog
        open={modelDialog}
        onOpenChange={setModelDialog}
        title="Add model"
        description="Models reuse a configured provider connection."
      >
        <ModelForm
          providers={providers}
          onSaved={() => {
            setModelDialog(false)
            void load()
          }}
        />
      </Dialog>
      <Dialog
        open={editingModel !== null}
        onOpenChange={(open) => {
          if (!open) setEditingModel(null)
        }}
        title="Edit model"
        description="Update the model, provider connection, parameters, status, and pricing."
      >
        {editingModel && (
          <ModelForm
            key={editingModel.id}
            model={editingModel}
            providers={providers}
            onSaved={() => {
              setEditingModel(null)
              void load()
            }}
          />
        )}
      </Dialog>
    </section>
  )
}

function ProviderList({
  providers,
  limits,
  isLoading,
  onAdd,
  onRemove,
  onRefreshPrices,
}: {
  providers: ProviderConfiguration[]
  limits: Record<number, OpenRouterLimits>
  isLoading: boolean
  onAdd: () => void
  onRemove: (provider: ProviderConfiguration) => Promise<void>
  onRefreshPrices: (providerId: number) => Promise<void>
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Providers</h2>
            <p className="text-sm text-muted-foreground">
              API keys are encrypted and never shown again.
            </p>
          </div>
          <Button disabled={isLoading} onClick={onAdd}>
            <Plus className="size-4" /> Add provider
          </Button>
        </div>
        {isLoading ? (
          <LoadingRow label="Loading providers…" />
        ) : providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No providers yet. Add one to store its connection and API key.
          </p>
        ) : (
          <div className="space-y-2">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between rounded border p-3"
              >
                <div>
                  <div className="font-medium">
                    {provider.display_name} {" "}
                    <Badge variant="outline">{LABELS[provider.kind]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {provider.base_url ?? "Official endpoint"} · {credentialLabel(provider)}
                  </div>
                  {provider.kind === "openrouter" && <div className="mt-1 text-xs text-muted-foreground">
                    {formatOpenRouterLimits(limits[provider.id])}
                  </div>}
                </div>
                <div className="flex items-center">
                {provider.kind === "openrouter" && <Button variant="ghost" size="icon" onClick={() => void onRefreshPrices(provider.id)} aria-label={`Refresh prices for ${provider.display_name}`}>
                  <RefreshCw className="size-4" />
                </Button>}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${provider.display_name}`}
                  onClick={() => void onRemove(provider)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ModelList({
  providersAvailable,
  models,
  isLoading,
  onAdd,
  onEdit,
  onRemove,
}: {
  providersAvailable: boolean
  models: ModelConfiguration[]
  isLoading: boolean
  onAdd: () => void
  onEdit: (model: ModelConfiguration) => void
  onRemove: (model: ModelConfiguration) => Promise<void>
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Models</h2>
            <p className="text-sm text-muted-foreground">
              Choose a provider connection for each model.
            </p>
          </div>
          <Button disabled={isLoading || !providersAvailable} onClick={onAdd}>
            <Plus className="size-4" /> Add model
          </Button>
        </div>
        {isLoading ? (
          <LoadingRow label="Loading models…" />
        ) : !providersAvailable ? (
          <p className="text-sm text-muted-foreground">Create a provider first.</p>
        ) : models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No models yet. Add one to make it available for evaluations.
          </p>
        ) : (
          models.map((model) => (
            <div
              key={model.id}
              className="flex items-center justify-between gap-3 rounded border p-3"
            >
              <div>
                <div className="font-medium">{model.display_name}</div>
                <div className="text-xs text-muted-foreground">
                  {model.model_name} · {model.provider.display_name}
                  {!model.runnable && ` · ${model.unavailable_reason}`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatModelPricing(model)}
                </div>
                {model.provider.kind === "openrouter" && <div className="mt-1 text-xs text-muted-foreground">Upstream per-model rate quota: Unknown{model.requests_per_minute ? ` · local limit ${model.requests_per_minute} requests/min` : ""}{model.max_concurrent_requests ? ` · local concurrency ${model.max_concurrent_requests}` : ""}</div>}
              </div>
              <div className="flex">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${model.display_name}`}
                  onClick={() => onEdit(model)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${model.display_name}`}
                  onClick={() => void onRemove(model)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function LoadingRow({ label }: { label: string }) {
  return (
    <p className="flex min-h-16 items-center gap-2 rounded border bg-muted/30 px-3 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" /> {label}
    </p>
  )
}

function ProviderForm({ onSaved }: { onSaved: () => void }) {
  const [kind, setKind] = useState<Provider>("ollama")
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434")
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const customUrl = ["ollama", "openai_compatible", "custom"].includes(kind)

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const input: ProviderConfigurationInput = {
        display_name: name,
        kind,
        base_url: customUrl ? baseUrl || null : null,
        ...(apiKey ? { api_key: apiKey } : {}),
      }
      await createProvider(input)
      onSaved()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <label className="block text-sm">
        Display name
        <Input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="OpenAI work account"
        />
      </label>
      <label className="block text-sm">
        Provider
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as Provider)}
        >
          {PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>{LABELS[provider]}</option>
          ))}
        </Select>
      </label>
      {customUrl && (
        <label className="block text-sm">
          Base URL
          <Input
            required={kind !== "ollama"}
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
      )}
      {kind !== "custom" && (
        <label className="block text-sm">
          API key <span className="text-muted-foreground">(optional where supported)</span>
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="new-password"
          />
        </label>
      )}
      <Button type="submit">
        <KeyRound className="size-4" /> Save provider
      </Button>
    </form>
  )
}

function ModelForm({
  providers,
  model,
  onSaved,
}: {
  providers: ProviderConfiguration[]
  model?: ModelConfiguration
  onSaved: () => void
}) {
  const [name, setName] = useState(model?.display_name ?? "")
  const [providerId, setProviderId] = useState(String(model?.provider.id ?? providers[0]?.id ?? ""))
  const [modelName, setModelName] = useState(model?.model_name ?? "")
  const [parameters, setParameters] = useState(JSON.stringify(model?.parameters ?? {}, null, 2))
  const [active, setActive] = useState(model?.active ?? true)
  const initialProvider = providers.find((item) => String(item.id) === String(model?.provider.id ?? providers[0]?.id))
  const [pricingMode, setPricingMode] = useState<PricingSelection["mode"]>(model?.pricing_mode ?? (model?.pricing?.source === "manual" ? "manual" : model?.pricing?.source === "catalog" ? "catalog" : model ? "unavailable" : initialProvider?.kind === "openrouter" ? "automatic" : "catalog"))
  const [inputPrice, setInputPrice] = useState(model?.pricing?.input_usd_per_million_tokens ?? "")
  const [outputPrice, setOutputPrice] = useState(model?.pricing?.output_usd_per_million_tokens ?? "")
  const [rpm, setRpm] = useState(model?.requests_per_minute?.toString() ?? "")
  const [maxConcurrent, setMaxConcurrent] = useState(model?.max_concurrent_requests?.toString() ?? "")
  const [pricingChanged, setPricingChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateIdentity(nextProviderId: string, nextModelName: string) {
    if (model && nextProviderId === String(model.provider.id) && nextModelName === model.model_name) {
      setPricingMode(model.pricing_mode ?? (model.pricing?.source === "manual" ? "manual" : model.pricing?.source === "catalog" ? "catalog" : "unavailable"))
      setInputPrice(model.pricing?.input_usd_per_million_tokens ?? "")
      setOutputPrice(model.pricing?.output_usd_per_million_tokens ?? "")
      setPricingChanged(false)
    } else {
      const selectedProvider = providers.find((item) => String(item.id) === nextProviderId)
      setPricingMode(selectedProvider?.kind === "openrouter" ? "automatic" : "catalog")
      setInputPrice("")
      setOutputPrice("")
      setPricingChanged(true)
    }
    setProviderId(nextProviderId)
    setModelName(nextModelName)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const parsed: unknown = JSON.parse(parameters)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Parameters must be a JSON object.")
      }
      const input: ModelConfigurationInput = {
        display_name: name,
        provider_id: Number(providerId),
        model_name: modelName,
        parameters: parsed as Record<string, unknown>,
        active,
        ...(providers.find((item) => String(item.id) === providerId)?.kind === "openrouter" ? {
          requests_per_minute: rpm ? Number(rpm) : null,
          max_concurrent_requests: maxConcurrent ? Number(maxConcurrent) : null,
        } : {}),
        ...(model && !pricingChanged ? {} : { pricing: pricingSelection(pricingMode, inputPrice, outputPrice) }),
      }
      if (model) await updateModel(model.id, input)
      else await createModel(input)
      onSaved()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <label className="block text-sm">
        Display name
        <Input required value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="block text-sm">
        Provider
        <Select value={providerId} onChange={(event) => {
          updateIdentity(event.target.value, modelName)
        }}>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.display_name} · {LABELS[provider.kind]}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-sm">
        Model name
        <Input
          required
          value={modelName}
          onChange={(event) => {
            updateIdentity(providerId, event.target.value)
          }}
          placeholder="gpt-5.6-sol"
        />
      </label>
      <label className="block text-sm">
        Default parameters
        <Textarea
          rows={4}
          value={parameters}
          onChange={(event) => setParameters(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Active
      </label>
      {model && pricingChanged && (providerId !== String(model.provider.id) || modelName !== model.model_name) && (
        <p className="text-xs text-muted-foreground">
          Changing the provider or model ID resets pricing to automatic OpenRouter pricing or the built-in catalog, depending on the selected provider.
        </p>
      )}
      <details open={!!model}>
        <summary className="cursor-pointer text-sm font-medium">Advanced pricing</summary>
        <div className="mt-3">
          <PricingFields
            mode={pricingMode}
            automaticAvailable={providers.find((item) => String(item.id) === providerId)?.kind === "openrouter"}
            inputPrice={inputPrice}
            outputPrice={outputPrice}
            onMode={(value) => { setPricingMode(value); setPricingChanged(true) }}
            onInput={(value) => { setInputPrice(value); setPricingChanged(true) }}
            onOutput={(value) => { setOutputPrice(value); setPricingChanged(true) }}
          />
        </div>
      </details>
      {providers.find((item) => String(item.id) === providerId)?.kind === "openrouter" && <div className="space-y-2 rounded border p-3">
        <p className="text-sm font-medium">Local request limits</p>
        <p className="text-xs text-muted-foreground">OpenRouter does not publish dependable per-model quotas. These controls apply to requests from this dashboard.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Requests per minute<Input type="number" min="1" max="100000" value={rpm} onChange={(event) => setRpm(event.target.value)} placeholder="No limit" /></label>
          <label className="block text-sm">Concurrent requests<Input type="number" min="1" max="1000" value={maxConcurrent} onChange={(event) => setMaxConcurrent(event.target.value)} placeholder="No limit" /></label>
        </div>
      </div>}
      <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save model"}</Button>
    </form>
  )
}

function PricingFields({
  mode,
  automaticAvailable,
  inputPrice,
  outputPrice,
  onMode,
  onInput,
  onOutput,
}: {
  mode: PricingSelection["mode"]
  automaticAvailable: boolean
  inputPrice: string
  outputPrice: string
  onMode: (value: PricingSelection["mode"]) => void
  onInput: (value: string) => void
  onOutput: (value: string) => void
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        Pricing basis
        <Select
          value={mode}
          onChange={(event) => onMode(event.target.value as PricingSelection["mode"])}
        >
          <option value="catalog">Built-in catalog</option>
          {automaticAvailable && <option value="automatic">Automatic OpenRouter pricing</option>}
          <option value="manual">Manual USD rates</option>
          <option value="unavailable">No price available</option>
        </Select>
      </label>
      {mode === "manual" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <PriceInput label="Input USD / 1M tokens" value={inputPrice} onChange={onInput} />
          <PriceInput label="Output USD / 1M tokens" value={outputPrice} onChange={onOutput} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Unknown catalog models remain runnable, but their cost is unavailable. You
        can enter explicit rates, including zero.
      </p>
    </div>
  )
}

function PriceInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm">
      {label}
      <Input
        required
        type="number"
        min="0"
        max="1000"
        step="0.000001"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function pricingSelection(
  mode: PricingSelection["mode"],
  inputPrice: string,
  outputPrice: string,
): PricingSelection {
  return mode === "manual"
    ? {
        mode,
        input_usd_per_million_tokens: inputPrice,
        output_usd_per_million_tokens: outputPrice,
      }
    : { mode }
}

function formatModelPricing(model: ModelConfiguration) {
  if (!model.pricing) return model.pricing_mode === "automatic" ? "Automatic OpenRouter price unavailable · estimated cost unavailable" : "Estimated cost unavailable"
  const fetched = model.pricing.source === "openrouter"
  return `Estimated pricing: $${model.pricing.input_usd_per_million_tokens} input / $${model.pricing.output_usd_per_million_tokens} output per 1M tokens · ${fetched ? "OpenRouter" : model.pricing.source} · ${fetched ? `retrieved ${model.pricing.fetched_at ?? model.pricing.effective_date}${model.pricing.stale ? " · stale" : ""}` : `effective ${model.pricing.effective_date}`}`
}

function formatOpenRouterLimits(limits?: OpenRouterLimits) {
  if (!limits?.supported) return "Quota metadata unavailable for this endpoint."
  if (!limits.available) return "Quota unknown · OpenRouter account metadata unavailable."
  const daily = limits.free_model_daily_requests
  const pieces = [daily ? `Free-model requests: ${daily.remaining ?? "?"} of ${daily.limit ?? "?"} remaining today` : "Free-model daily quota unknown"]
  pieces.push(limits.limit_remaining_usd == null ? "Key spend remaining unknown" : `$${limits.limit_remaining_usd} key spend remaining`)
  return `Advisory · ${pieces.join(" · ")}`
}

function credentialLabel(provider: ProviderConfiguration) {
  if (provider.has_api_key) return "API key configured"
  if (provider.api_key_requirement === "required") return "API key required"
  return "No API key"
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}
