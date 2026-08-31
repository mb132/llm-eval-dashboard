import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState, type FormEvent } from "react"

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
} from "@/api/providers"
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
  "anthropic",
  "gemini",
  "openai_compatible",
  "custom",
]
const LABELS: Record<Provider, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openai_compatible: "OpenAI-compatible API",
  custom: "Custom endpoint",
}

export function ModelsPage() {
  const [providers, setProviders] = useState<ProviderConfiguration[]>([])
  const [models, setModels] = useState<ModelConfiguration[]>([])
  const [providerDialog, setProviderDialog] = useState(false)
  const [modelDialog, setModelDialog] = useState(false)
  const [pricingModel, setPricingModel] = useState<ModelConfiguration | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextProviders, nextModels] = await Promise.all([
        listProviders(),
        listModels(),
      ])
      setProviders(nextProviders)
      setModels(nextModels)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [])

  useEffect(() => {
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
    <section className="space-y-8">
      <div>
        <Badge variant="secondary">Configuration</Badge>
        <h1 className="mt-3 text-3xl font-semibold">Models</h1>
        <p className="mt-2 text-muted-foreground">
          Add a provider connection once, then reuse it for one or more models.
        </p>
      </div>
      {error && (
        <p
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}

      <ProviderList
        providers={providers}
        onAdd={() => setProviderDialog(true)}
        onRemove={removeProvider}
      />
      <ModelList
        providersAvailable={providers.length > 0}
        models={models}
        onAdd={() => setModelDialog(true)}
        onEditPricing={setPricingModel}
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
        open={pricingModel !== null}
        onOpenChange={(open) => {
          if (!open) setPricingModel(null)
        }}
        title="Edit model pricing"
        description="Costs are estimates based on these USD rates and reported token usage."
      >
        {pricingModel && (
          <PricingForm
            model={pricingModel}
            onSaved={() => {
              setPricingModel(null)
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
  onAdd,
  onRemove,
}: {
  providers: ProviderConfiguration[]
  onAdd: () => void
  onRemove: (provider: ProviderConfiguration) => Promise<void>
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
          <Button onClick={onAdd}>
            <Plus className="mr-2 size-4" /> Add provider
          </Button>
        </div>
        {providers.length === 0 ? (
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
                </div>
                <Button
                  className="bg-transparent p-2 text-foreground hover:bg-muted"
                  aria-label={`Remove ${provider.display_name}`}
                  onClick={() => void onRemove(provider)}
                >
                  <Trash2 className="size-4 text-red-600" />
                </Button>
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
  onAdd,
  onEditPricing,
  onRemove,
}: {
  providersAvailable: boolean
  models: ModelConfiguration[]
  onAdd: () => void
  onEditPricing: (model: ModelConfiguration) => void
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
          <Button disabled={!providersAvailable} onClick={onAdd}>
            <Plus className="mr-2 size-4" /> Add model
          </Button>
        </div>
        {!providersAvailable && (
          <p className="text-sm text-muted-foreground">Create a provider first.</p>
        )}
        {models.map((model) => (
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
            </div>
            <div className="flex">
              <Button
                className="bg-transparent p-2 text-foreground hover:bg-muted"
                aria-label={`Edit pricing for ${model.display_name}`}
                onClick={() => onEditPricing(model)}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                className="bg-transparent p-2 text-foreground hover:bg-muted"
                aria-label={`Remove ${model.display_name}`}
                onClick={() => void onRemove(model)}
              >
                <Trash2 className="size-4 text-red-600" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
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
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
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
        <KeyRound className="mr-2 size-4" /> Save provider
      </Button>
    </form>
  )
}

function ModelForm({
  providers,
  onSaved,
}: {
  providers: ProviderConfiguration[]
  onSaved: () => void
}) {
  const [name, setName] = useState("")
  const [providerId, setProviderId] = useState(String(providers[0]?.id ?? ""))
  const [modelName, setModelName] = useState("")
  const [parameters, setParameters] = useState("{}")
  const [pricingMode, setPricingMode] = useState<PricingSelection["mode"]>("catalog")
  const [inputPrice, setInputPrice] = useState("")
  const [outputPrice, setOutputPrice] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
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
        active: true,
        pricing: pricingSelection(pricingMode, inputPrice, outputPrice),
      }
      await createModel(input)
      onSaved()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <label className="block text-sm">
        Display name
        <Input required value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="block text-sm">
        Provider
        <Select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
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
          onChange={(event) => setModelName(event.target.value)}
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
      <details>
        <summary className="cursor-pointer text-sm font-medium">Advanced pricing</summary>
        <div className="mt-3">
          <PricingFields
            mode={pricingMode}
            inputPrice={inputPrice}
            outputPrice={outputPrice}
            onMode={setPricingMode}
            onInput={setInputPrice}
            onOutput={setOutputPrice}
          />
        </div>
      </details>
      <Button type="submit">Save model</Button>
    </form>
  )
}

function PricingForm({
  model,
  onSaved,
}: {
  model: ModelConfiguration
  onSaved: () => void
}) {
  const initialMode = model.pricing?.source === "manual"
    ? "manual"
    : model.pricing
      ? "catalog"
      : "unavailable"
  const [mode, setMode] = useState<PricingSelection["mode"]>(initialMode)
  const [inputPrice, setInputPrice] = useState(
    model.pricing?.input_usd_per_million_tokens ?? "",
  )
  const [outputPrice, setOutputPrice] = useState(
    model.pricing?.output_usd_per_million_tokens ?? "",
  )
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await updateModel(model.id, {
        pricing: pricingSelection(mode, inputPrice, outputPrice),
      })
      onSaved()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <PricingFields
        mode={mode}
        inputPrice={inputPrice}
        outputPrice={outputPrice}
        onMode={setMode}
        onInput={setInputPrice}
        onOutput={setOutputPrice}
      />
      <Button type="submit">Save pricing</Button>
    </form>
  )
}

function PricingFields({
  mode,
  inputPrice,
  outputPrice,
  onMode,
  onInput,
  onOutput,
}: {
  mode: PricingSelection["mode"]
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
          <option value="catalog">Built-in catalog (exact model match)</option>
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
  if (!model.pricing) return "Estimated cost unavailable"
  return `Estimated pricing: $${model.pricing.input_usd_per_million_tokens} input / $${model.pricing.output_usd_per_million_tokens} output per 1M tokens · ${model.pricing.source} · effective ${model.pricing.effective_date}`
}

function credentialLabel(provider: ProviderConfiguration) {
  if (provider.has_api_key) return "API key configured"
  if (provider.api_key_requirement === "required") return "API key required"
  return "No API key"
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}
