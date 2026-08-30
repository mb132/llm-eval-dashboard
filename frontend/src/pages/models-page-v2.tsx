import { KeyRound, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState, type FormEvent } from "react"

import {
  createModel,
  deleteModel,
  listModels,
  type ModelConfiguration,
  type ModelConfigurationInput,
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

const PROVIDERS: Provider[] = ["ollama", "openai", "anthropic", "gemini", "openai_compatible", "custom"]
const LABELS: Record<Provider, string> = { ollama: "Ollama", openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", openai_compatible: "OpenAI-compatible API", custom: "Custom endpoint" }

export function ModelsPage() {
  const [providers, setProviders] = useState<ProviderConfiguration[]>([])
  const [models, setModels] = useState<ModelConfiguration[]>([])
  const [providerDialog, setProviderDialog] = useState(false)
  const [modelDialog, setModelDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextProviders, nextModels] = await Promise.all([listProviders(), listModels()])
      setProviders(nextProviders)
      setModels(nextModels)
    } catch (caught) { setError(message(caught)) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function removeProvider(provider: ProviderConfiguration) {
    if (!window.confirm(`Remove “${provider.display_name}”?`)) return
    try { await deleteProvider(provider.id); await load() } catch (caught) { setError(message(caught)) }
  }
  async function removeModel(model: ModelConfiguration) {
    if (!window.confirm(`Remove “${model.display_name}”?`)) return
    try { await deleteModel(model.id); await load() } catch (caught) { setError(message(caught)) }
  }

  return <section className="space-y-8">
    <div className="flex items-end justify-between"><div><Badge variant="secondary">Configuration</Badge><h1 className="mt-3 text-3xl font-semibold">Models</h1><p className="mt-2 text-muted-foreground">Add a provider connection once, then reuse it for one or more models.</p></div></div>
    {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
    <Card><CardContent className="space-y-4 p-6"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Providers</h2><p className="text-sm text-muted-foreground">API keys are encrypted and never shown again.</p></div><Button onClick={() => setProviderDialog(true)}><Plus className="mr-2 size-4" />Add provider</Button></div>
      {providers.length === 0 ? <p className="text-sm text-muted-foreground">No providers yet. Add one to store its connection and API key.</p> : <div className="space-y-2">{providers.map((provider) => <div key={provider.id} className="flex items-center justify-between rounded border p-3"><div><div className="font-medium">{provider.display_name} <Badge variant="outline">{LABELS[provider.kind]}</Badge></div><div className="text-xs text-muted-foreground">{provider.base_url ?? "Official endpoint"} · {provider.has_api_key ? "API key configured" : provider.api_key_requirement === "required" ? "API key required" : "No API key"}</div></div><Button className="bg-transparent p-2 text-foreground hover:bg-muted" aria-label={`Remove ${provider.display_name}`} onClick={() => void removeProvider(provider)}><Trash2 className="size-4 text-red-600" /></Button></div>)}</div>}
    </CardContent></Card>
    <Card><CardContent className="space-y-4 p-6"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Models</h2><p className="text-sm text-muted-foreground">Choose a provider connection for each model.</p></div><Button disabled={!providers.length} onClick={() => setModelDialog(true)}><Plus className="mr-2 size-4" />Add model</Button></div>
      {!providers.length && <p className="text-sm text-muted-foreground">Create a provider first.</p>}
      {models.map((model) => <div key={model.id} className="flex items-center justify-between rounded border p-3"><div><div className="font-medium">{model.display_name}</div><div className="text-xs text-muted-foreground">{model.model_name} · {(model.provider as any).display_name ?? "Provider"}{!model.runnable && ` · ${model.unavailable_reason}`}</div></div><Button className="bg-transparent p-2 text-foreground hover:bg-muted" aria-label={`Remove ${model.display_name}`} onClick={() => void removeModel(model)}><Trash2 className="size-4 text-red-600" /></Button></div>)}
    </CardContent></Card>
    <Dialog open={providerDialog} onOpenChange={setProviderDialog} title="Add provider" description="The API key is write-only and encrypted in the local database."><ProviderForm onSaved={() => { setProviderDialog(false); void load() }} /></Dialog>
    <Dialog open={modelDialog} onOpenChange={setModelDialog} title="Add model" description="Models reuse a configured provider connection."><ModelForm providers={providers} onSaved={() => { setModelDialog(false); void load() }} /></Dialog>
  </section>
}

function ProviderForm({ onSaved }: { onSaved: () => void }) {
  const [kind, setKind] = useState<Provider>("ollama"); const [name, setName] = useState(""); const [baseUrl, setBaseUrl] = useState("http://localhost:11434"); const [apiKey, setApiKey] = useState(""); const [error, setError] = useState<string | null>(null)
  const customUrl = kind === "ollama" || kind === "openai_compatible" || kind === "custom"
  async function submit(event: FormEvent) { event.preventDefault(); try { const input: ProviderConfigurationInput = { display_name: name, kind, base_url: customUrl ? baseUrl || null : null, ...(apiKey ? { api_key: apiKey } : {}) }; await createProvider(input); onSaved() } catch (caught) { setError(message(caught)) } }
  return <form className="space-y-4" onSubmit={submit}>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<label className="block text-sm">Display name<Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenAI work account" /></label><label className="block text-sm">Provider<Select value={kind} onChange={(e) => setKind(e.target.value as Provider)}>{PROVIDERS.map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}</Select></label>{customUrl && <label className="block text-sm">Base URL<Input required={kind !== "ollama"} type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>}{kind !== "custom" && <label className="block text-sm">API key <span className="text-muted-foreground">(optional where supported)</span><Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" /></label>}<Button type="submit"><KeyRound className="mr-2 size-4" />Save provider</Button></form>
}

function ModelForm({ providers, onSaved }: { providers: ProviderConfiguration[]; onSaved: () => void }) {
  const [name, setName] = useState(""); const [providerId, setProviderId] = useState(String(providers[0]?.id ?? "")); const [modelName, setModelName] = useState(""); const [parameters, setParameters] = useState("{}"); const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) { event.preventDefault(); try { const parsed = JSON.parse(parameters); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Parameters must be a JSON object."); const input: ModelConfigurationInput = { display_name: name, provider_id: Number(providerId), model_name: modelName, parameters: parsed, active: true }; await createModel(input); onSaved() } catch (caught) { setError(message(caught)) } }
  return <form className="space-y-4" onSubmit={submit}>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<label className="block text-sm">Display name<Input required value={name} onChange={(e) => setName(e.target.value)} /></label><label className="block text-sm">Provider<Select value={providerId} onChange={(e) => setProviderId(e.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.display_name} · {LABELS[provider.kind]}</option>)}</Select></label><label className="block text-sm">Model name<Input required value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="gpt-5" /></label><label className="block text-sm">Default parameters<Textarea rows={4} value={parameters} onChange={(e) => setParameters(e.target.value)} /></label><Button type="submit">Save model</Button></form>
}

function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong." }
