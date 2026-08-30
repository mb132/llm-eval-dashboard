import { AlertCircle, KeyRound, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState, type FormEvent } from "react"

import {
  PROVIDERS,
  createModel,
  deleteModel,
  listModels,
  updateModel,
  type ModelConfiguration,
  type ModelConfigurationInput,
  type Provider,
} from "@/api/models"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

const PROVIDER_LABELS: Record<Provider, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openai_compatible: "OpenAI-compatible API",
  custom: "Custom endpoint",
}

const CREDENTIAL_ENV_VAR_BY_PROVIDER: Partial<Record<Provider, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
}

const PROVIDERS_WITH_CONFIGURABLE_BASE_URL: Provider[] = [
  "ollama",
  "openai_compatible",
  "custom",
]

const EMPTY_FORM: ModelConfigurationInput = {
  display_name: "",
  provider: "ollama",
  model_name: "",
  base_url: "http://localhost:11434",
  api_key_env_var: null,
  parameters: {},
  active: true,
}

export function ModelsPage() {
  const [models, setModels] = useState<ModelConfiguration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ModelConfiguration | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setModels(await listModels())
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(model: ModelConfiguration) {
    setEditing(model)
    setDialogOpen(true)
  }

  async function toggleActive(model: ModelConfiguration) {
    try {
      const updated = await updateModel(model.id, { active: !model.active })
      setModels((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    }
  }

  async function remove(model: ModelConfiguration) {
    if (!window.confirm(`Remove “${model.display_name}”?`)) return
    try {
      await deleteModel(model.id)
      setModels((current) => current.filter((item) => item.id !== model.id))
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Badge variant="secondary">Configuration</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Models</h1>
          <p className="mt-2 text-muted-foreground">
            Configure language models for the playground and future evaluations.
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 size-4" />Add model</Button>
      </div>

      {error && <ErrorBanner message={error} />}

      <Card className="gap-0 overflow-hidden py-0 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />Loading models…
            </div>
          ) : models.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-medium">No models configured</p>
              <p className="mt-1 text-sm text-muted-foreground">Add Ollama or another provider to get started.</p>
              <Button className="mt-5" onClick={openCreate}><Plus className="mr-2 size-4" />Add model</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Credentials</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <div className="font-medium">{model.display_name}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{model.model_name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{PROVIDER_LABELS[model.provider]}</Badge>
                      {model.base_url && <div className="mt-1 max-w-56 truncate text-xs text-muted-foreground">{model.base_url}</div>}
                    </TableCell>
                    <TableCell><CredentialStatus model={model} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch checked={model.active} onCheckedChange={() => void toggleActive(model)} aria-label={`${model.active ? "Deactivate" : "Activate"} ${model.display_name}`} />
                        <span className="text-xs text-muted-foreground">{model.active ? "Active" : "Inactive"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button className="size-9 bg-transparent p-0 text-foreground hover:bg-muted" aria-label={`Edit ${model.display_name}`} onClick={() => openEdit(model)}><Pencil className="size-4" /></Button>
                        <Button className="size-9 bg-transparent p-0 text-red-600 hover:bg-red-50" aria-label={`Remove ${model.display_name}`} onClick={() => void remove(model)}><Trash2 className="size-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Edit model" : "Add model"}
        description="Credentials are referenced by environment-variable name. Secret values stay on the server."
      >
        <ModelForm
          key={editing?.id ?? "new"}
          model={editing}
          onCancel={() => setDialogOpen(false)}
          onSaved={(saved) => {
            setModels((current) => editing ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved])
            setDialogOpen(false)
          }}
        />
      </Dialog>
    </section>
  )
}

function ModelForm({ model, onCancel, onSaved }: { model: ModelConfiguration | null; onCancel: () => void; onSaved: (model: ModelConfiguration) => void }) {
  const [form, setForm] = useState<ModelConfigurationInput>(() => model ? {
    display_name: model.display_name,
    provider: model.provider,
    model_name: model.model_name,
    base_url: model.base_url,
    api_key_env_var: model.api_key_env_var,
    parameters: model.parameters,
    active: model.active,
  } : EMPTY_FORM)
  const [parametersText, setParametersText] = useState(() => JSON.stringify(model?.parameters ?? {}, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const credentialEnvVar = CREDENTIAL_ENV_VAR_BY_PROVIDER[form.provider ?? "ollama"]

  function changeProvider(provider: Provider) {
    const supportsCustomBaseUrl = PROVIDERS_WITH_CONFIGURABLE_BASE_URL.includes(provider)
    setForm({
      ...form,
      provider,
      api_key_env_var: CREDENTIAL_ENV_VAR_BY_PROVIDER[provider] ?? null,
      base_url: supportsCustomBaseUrl
        ? provider === "ollama"
          ? form.base_url ?? "http://localhost:11434"
          : form.base_url
        : null,
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    let parameters: unknown
    try {
      parameters = JSON.parse(parametersText)
      if (parameters === null || Array.isArray(parameters) || typeof parameters !== "object") throw new Error()
    } catch {
      setError("Parameters must be a valid JSON object.")
      return
    }

    setSaving(true)
    try {
      const input = { ...form, parameters: parameters as Record<string, unknown> }
      onSaved(model ? await updateModel(model.id, input) : await createModel(input))
    } catch (caughtError) {
      setError(errorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {error && <ErrorBanner message={error} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Display name" htmlFor="display-name">
          <Input id="display-name" required value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} placeholder="Local Gemma" />
        </Field>
        <Field label="Provider" htmlFor="provider">
          <Select id="provider" value={form.provider} onChange={(event) => changeProvider(event.target.value as Provider)}>
            {PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
          </Select>
        </Field>
        <Field label="Model name" htmlFor="model-name">
          <Input id="model-name" required value={form.model_name} onChange={(event) => setForm({ ...form, model_name: event.target.value })} placeholder="gemma4:e4b" />
        </Field>
        <Field label="Base URL" htmlFor="base-url" hint="Optional for providers with standard endpoints.">
          <Input id="base-url" type="url" value={form.base_url ?? ""} onChange={(event) => setForm({ ...form, base_url: event.target.value || null })} placeholder="http://localhost:11434" />
        </Field>
      </div>
      <Field label="API-key environment variable" htmlFor="api-key-env" hint={credentialEnvVar ? "Fixed by the provider; the secret value remains server-side." : "This provider cannot send a server credential to a configurable endpoint."}>
        <Input id="api-key-env" value={credentialEnvVar ?? ""} readOnly placeholder="Not used" autoComplete="off" />
      </Field>
      <Field label="Default parameters" htmlFor="parameters" hint="Optional JSON object passed to the provider later.">
        <Textarea id="parameters" rows={5} value={parametersText} onChange={(event) => setParametersText(event.target.value)} />
      </Field>
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div><div className="text-sm font-medium">Active</div><div className="text-xs text-muted-foreground">Make this model available for evaluations.</div></div>
        <Switch checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} />
      </div>
      <div className="flex justify-end gap-3 border-t pt-5">
        <Button type="button" className="bg-transparent text-foreground hover:bg-muted" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving && <LoaderCircle className="mr-2 size-4 animate-spin" />}{model ? "Save changes" : "Add model"}</Button>
      </div>
    </form>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><label className="text-sm font-medium" htmlFor={htmlFor}>{label}</label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
}

function CredentialStatus({ model }: { model: ModelConfiguration }) {
  if (!model.api_key_env_var) return <span className="text-xs text-muted-foreground">Not required</span>
  return <div className="flex items-center gap-2"><KeyRound className={`size-3.5 ${model.has_credentials ? "text-emerald-600" : "text-amber-600"}`} /><div><div className="font-mono text-xs">{model.api_key_env_var}</div><div className="text-xs text-muted-foreground">{model.has_credentials ? "Available on server" : "Not set on server"}</div></div></div>
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" /><p>{message}</p></div>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}
