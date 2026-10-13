import { Lock, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useId, type ReactNode, type FormEvent } from "react"

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
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { Field } from "@/components/ui/field"
import { InlineConfirm } from "@/components/ui/inline-confirm"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatInt, formatPricePerMillion, formatDateTime, formatUsd } from "@/lib/format"


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


function useMounted() {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  return mounted
}

export function ModelsPage() {
  const [providers, setProviders] = useState<ProviderConfiguration[]>([])
  const [models, setModels] = useState<ModelConfiguration[]>([])
  const [limits, setLimits] = useState<Record<number, OpenRouterLimits>>({})
  const [providerDialog, setProviderDialog] = useState(false)
  const [modelDialog, setModelDialog] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelConfiguration | null>(null)
  const [pricingFocus, setPricingFocus] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const initialLoadStarted = useRef(false)
  const generation = useRef(0)
  const mounted = useMounted()

  const load = useCallback(async () => {
    const request = ++generation.current
    setIsLoading(true)
    setError(null)
    try {
      const [nextProviders, nextModels] = await Promise.all([listProviders(), listModels()])
      if (!mounted.current || request !== generation.current) return
      setProviders(nextProviders)
      setModels(nextModels)
      setHasLoaded(true)
      setLimits({})
      // Optional quota requests must not prevent the models list from loading.
      void Promise.all(nextProviders.filter((provider) => provider.kind === "openrouter").map(async (provider) => {
        try { return [provider.id, await getOpenRouterLimits(provider.id)] as const }
        catch { return [provider.id, { available: false, supported: true, fetched_at: null }] as const }
      })).then((nextLimits) => {
        if (mounted.current && request === generation.current) setLimits(Object.fromEntries(nextLimits))
      })
    } catch (caught) {
      if (mounted.current && request === generation.current) setError(errorMessage(caught))
    } finally {
      if (mounted.current && request === generation.current) setIsLoading(false)
    }
  }, [mounted])

  useEffect(() => {
    if (initialLoadStarted.current) return
    initialLoadStarted.current = true
    void load()
  }, [load])

  async function refreshPrices(providerId: number) {
    const request = generation.current
    const result = await refreshOpenRouterPrices(providerId)
    if (!mounted.current || request !== generation.current) return null
    setModels((current) => [
      ...current.filter((model) => model.provider.id !== providerId), ...result.models,
    ].sort((a, b) => a.id - b.id))
    if (!result.available) throw new Error(result.message ?? "Could not refresh OpenRouter prices.")
    return result.message ?? "Prices refreshed."
  }
  const initialLoading = isLoading && !hasLoaded
  const securityCaption = (
    <span className="flex items-center gap-1.5 text-caption text-fg-muted">
      <Lock className="size-3.5" aria-hidden="true" />
      API keys are encrypted and never shown again.
    </span>
  )
  function edit(model: ModelConfiguration, focusPricing = false) {
    setPricingFocus(focusPricing)
    setEditingModel(model)
  }
  return (
    <PageFrame breadcrumbs={[{ label: "Models" }]} mobileTitle="Models" actions={securityCaption}>
      <PageHeader
        title="Models"
        description="Add a provider connection once, then reuse it for one or more models."
      />
      <div className="md:hidden">
        {securityCaption}
      </div>
      {error && <ErrorState message={error} onRetry={() => void load()} retrying={isLoading} />}
      <Card aria-busy={initialLoading}>
        <PanelHeading
          title="Models"
          count={hasLoaded ? `${formatInt(models.length)} · ${formatInt(models.filter((model) => model.active).length)} active` : "—"}
        >
          <Button
            variant="outline"
            disabled={!hasLoaded || !providers.length}
            onClick={() => setModelDialog(true)}
            className="max-md:h-11"
          >
            <Plus aria-hidden="true" />Add model</Button>
        </PanelHeading>
        {initialLoading ? <LoadingState label="Loading models…" /> : !hasLoaded ? <EmptyState title="Models unavailable" description="Retry loading the provider and model configurations." /> : !providers.length ? <EmptyState title="Add a provider first" /> : !models.length ? <EmptyState title="No models yet" description="Add one to make it available for evaluations." /> : (
        <Table className="block md:table md:min-w-[900px]">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              {["Model", "Provider", "Price per 1M tokens", "Limits", "Status", "Actions"].map((label) => <TableHead key={label} className={["Price per 1M tokens", "Limits", "Models"].includes(label) ? "md:text-right" : undefined}>
                {label}
              </TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody className="block md:table-row-group">
            {models.map((model) => <ModelRow key={model.id} model={model} onEdit={edit} onRemoved={() => void load()} />)}
          </TableBody>
        </Table>
        )}
      </Card>
      <Card aria-busy={initialLoading}>
        <PanelHeading title="Providers" count={hasLoaded ? formatInt(providers.length) : "—"}>
          <Button
            variant="outline"
            disabled={initialLoading}
            onClick={() => setProviderDialog(true)}
            className="max-md:h-11"
          >
            <Plus aria-hidden="true" />Add provider</Button>
        </PanelHeading>
        {initialLoading ? <LoadingState label="Loading providers…" /> : !hasLoaded ? <EmptyState title="Providers unavailable" description="Retry loading the provider configurations." /> : !providers.length ? <EmptyState title="No providers yet" description="Add one to store its connection and API key." /> : (
        <Table className="block md:table md:min-w-[900px]">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              {["Provider", "Endpoint", "API key", "Models", "Actions"].map((label) => <TableHead key={label} className={["Price per 1M tokens", "Limits", "Models"].includes(label) ? "md:text-right" : undefined}>
                {label}
              </TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody className="block md:table-row-group">
            {providers.map((provider) => <ProviderRow
              key={provider.id}
              provider={provider}
              limits={limits[provider.id]}
              onRefresh={refreshPrices}
              onRemoved={() => void load()}
            />)}
          </TableBody>
        </Table>
        )}
      </Card>
      {providerDialog && <ProviderForm
        onClose={() => setProviderDialog(false)}
        onSaved={() => { setProviderDialog(false); void load() }}
      />}
      {modelDialog && <ModelForm
        providers={providers}
        onClose={() => setModelDialog(false)}
        onSaved={() => { setModelDialog(false); void load() }}
      />}
      {editingModel && <ModelForm
        key={editingModel.id}
        providers={providers}
        model={editingModel}
        focusPricing={pricingFocus}
        onClose={() => setEditingModel(null)}
        onSaved={() => { setEditingModel(null); void load() }}
      />}
    </PageFrame>
  )
}

function PanelHeading({ title, count, children }: { title: string; count: string; children: ReactNode }) {
  return (
    <CardHeader>
      <CardTitle>
        {title}
      </CardTitle>
      <span className="font-mono text-data text-fg-muted">
        {count}
      </span>
      <div className="ml-auto">
        {children}
      </div>
    </CardHeader>
  )
}

const cell = "block min-w-0 md:table-cell max-md:px-0 max-md:py-0.5 [overflow-wrap:anywhere]"
const row = "relative block max-md:p-4 md:table-row"

function Removal({ name, snapshot, disabledReason, disabled = false, compact = false, onRemove, onPendingChange, children }: {
  name: string
  snapshot?: boolean
  disabledReason?: string
  disabled?: boolean
  compact?: boolean
  onRemove: () => Promise<void>
  onPendingChange?: (pending: boolean) => void
  children: (pending: boolean) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const mounted = useMounted()
  async function remove() {
    if (busy.current || disabledReason || disabled) return
    busy.current = true
    setPending(true)
    onPendingChange?.(true)
    setError(null)
    try {
      await onRemove()
      if (mounted.current) setOpen(false)
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught))
    } finally {
      busy.current = false
      if (mounted.current) {
        setPending(false)
        onPendingChange?.(false)
      }
    }
  }
  return (
    <div className="min-w-0 space-y-2">
      <div className={compact ? "flex items-center gap-2 max-md:absolute max-md:right-4 max-md:top-4" : "flex items-center gap-2 max-md:[&>button]:flex-1"}>
        {children(pending)}
        <Button
          ref={trigger}
          variant="ghost"
          size="icon"
          className={compact ? "relative max-md:size-11" : "relative max-md:h-11 max-md:w-auto max-md:px-3 max-md:border max-md:border-line-strong"}
          disabled={!!disabledReason || disabled || pending}
          aria-label={`Remove ${name}`}
          title={disabledReason}
          onClick={() => { setOpen(true); setError(null) }}
        >
          <Trash2 className="text-destructive" aria-hidden="true" />
          <span className={compact ? "sr-only" : "md:sr-only"}>Remove</span>
        </Button>
      </div>
      {disabledReason && <p className="text-caption text-fg-muted">
        {disabledReason}
      </p>}
      {open && <InlineConfirm
        label={`Remove ${name}?`}
        message={`Remove ${name}?${snapshot ? " Past runs keep their snapshot." : ""}`}
        confirmLabel={pending ? "Removing…" : "Remove"}
        pending={pending}
        returnFocusRef={trigger}
        onCancel={() => {
          if (!busy.current) {
            setOpen(false)
            setError(null)
          }
        }}
        onConfirm={() => void remove()}
      />}
      {error && <Alert variant="destructive" role="alert">
        {error}
      </Alert>}
    </div>
  )
}

function ModelRow({ model, onEdit, onRemoved }: { model: ModelConfiguration; onEdit: (model: ModelConfiguration, focusPricing?: boolean) => void; onRemoved: () => void }) {
  const mounted = useMounted()
  const [removing, setRemoving] = useState(false)
  return (
    <TableRow className={row}>
      <TableCell className={cell}>
        <div className="font-sans text-body font-medium max-md:pr-20">
          {model.display_name}
        </div>
        <div className="font-mono text-data text-fg-muted">
          {model.model_name}<span className="md:hidden"> · {model.provider.display_name}</span>
        </div>
        {!model.runnable && <p className="text-caption text-warning">⚠{" "}
          {model.unavailable_reason ?? "Model unavailable"}
        </p>}
      </TableCell>
      <TableCell className={`${cell} hidden md:table-cell`}>
        <div className="font-sans text-body">
          {model.provider.display_name}
        </div>
        <div className="text-caption text-fg-muted">
          {LABELS[model.provider.kind]}
        </div>
      </TableCell>
      <TableCell className={`${cell} md:text-right`}>
        <ModelPrice model={model} disabled={removing} onAdd={() => onEdit(model, true)} />
      </TableCell>
      <TableCell className={`${cell} md:text-right ${model.requests_per_minute == null && model.max_concurrent_requests == null && model.provider.kind !== "openrouter" ? "hidden md:table-cell" : ""}`}>
        <ModelLimits model={model} />
        {model.provider.kind === "openrouter" && <p className="font-mono text-data-sm text-fg-muted">Upstream per-model rate quota: unknown</p>}
      </TableCell>
      <TableCell className={`${cell} max-md:absolute max-md:right-4 max-md:top-4`}>
        <Badge variant={model.active ? "success" : "secondary"}>
          {model.active ? "✓ active" : "inactive"}
        </Badge>
      </TableCell>
      <TableCell className={`${cell} max-md:mt-2`}>
        <Removal
          name={model.display_name}
          snapshot
          onPendingChange={setRemoving}
          onRemove={async () => {
            await deleteModel(model.id)
            if (mounted.current) onRemoved()
          }}
        >
          {(pending) => <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            className="relative max-md:h-11 max-md:w-auto max-md:px-3 max-md:border max-md:border-line-strong"
            aria-label={`Edit ${model.display_name}`}
            onClick={() => onEdit(model)}
          >
            <Pencil aria-hidden="true" />
            <span className="md:sr-only">Edit</span>
          </Button>}
        </Removal>
      </TableCell>
    </TableRow>
  )
}

function ModelPrice({ model, onAdd, disabled }: { model: ModelConfiguration; onAdd: () => void; disabled?: boolean }) {
  const pricing = model.pricing
  if (!pricing) return (
    <>
      <div className="flex flex-wrap items-center gap-1 text-warning md:justify-end">
        <span>⚠ no price</span>
        <span className="md:hidden">· runs show cost as unpriced</span>
        <span className="hidden md:inline">·</span>
        <Button
          variant="link"
          size="xs"
          className="hidden md:inline-flex"
          onClick={onAdd}
          disabled={disabled}
          aria-label={`Add pricing for ${model.display_name}`}
        >Add pricing</Button>
      </div>
      <p className="hidden text-caption text-fg-muted md:block">Runs show its cost as unpriced</p>
    </>
  )
  const fetched = pricing.fetched_at ?? model.pricing_fetched_at
  return (
    <>
      <div className="font-mono text-data">
        {formatPricePerMillion(pricing.input_usd_per_million_tokens)}<span className="text-fg-muted"> in · </span>
        {formatPricePerMillion(pricing.output_usd_per_million_tokens)}<span className="text-fg-muted"> out</span>
      </div>
      <p className="hidden font-mono text-data-sm text-fg-muted md:block">
        {pricing.source} · effective{" "}
        {pricing.effective_date}
      </p>
      {(pricing.stale || pricing.source === "openrouter") && <p className={`font-mono text-data-sm ${pricing.stale ? "text-warning" : "text-fg-muted"}`}>
        {pricing.stale ? "⚠ stale · " : ""}
        {fetched ? `fetched ${formatDateTime(fetched)}` : "Fetch date unavailable"}
      </p>}
    </>
  )
}

function ProviderRow({ provider, limits, onRefresh, onRemoved }: { provider: ProviderConfiguration; limits?: OpenRouterLimits; onRefresh: (id: number) => Promise<string | null>; onRemoved: () => void }) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const mounted = useMounted()
  async function refresh() {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const result = await onRefresh(provider.id)
      if (mounted.current) setMessage(result)
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught))
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  return (
    <TableRow className={`${row} ${provider.kind === "openrouter" ? "max-md:pr-32" : "max-md:pr-18"}`}>
      <TableCell className={cell}>
        <div className="font-sans text-body font-medium">
          {provider.display_name}
        </div>
        <div className="hidden text-caption text-fg-muted md:block">
          {LABELS[provider.kind]}
        </div>
      </TableCell>
      <TableCell className={`${cell} max-md:inline font-mono text-data text-fg-muted`}>
        <span className="hidden md:inline">{provider.base_url ?? "Official endpoint"}</span>
        <span className="md:hidden" title={provider.base_url ?? undefined}>{compactEndpoint(provider.base_url)}</span>
      </TableCell>
      <TableCell className={`${cell} max-md:inline`}>
        <span className="font-mono text-data text-fg-muted md:hidden"> · </span>
        <span
          className={`font-mono text-data ${provider.has_api_key ? "text-success" : provider.api_key_requirement === "required" ? "text-warning" : "text-fg-muted"}`}
        >
          {credentialLabel(provider)}
        </span>
      </TableCell>
      <TableCell className={`${cell} max-md:inline font-mono text-data md:text-right`}>
        <span className="text-fg-muted md:hidden"> · </span>{formatInt(provider.model_count)}
        <span className="md:sr-only">{provider.model_count === 1 ? " model" : " models"}</span>
      </TableCell>
      <TableCell className={`${cell} ${provider.kind === "openrouter" ? "max-md:-mr-28" : "max-md:-mr-14"}`}>
        <Removal
          name={provider.display_name}
          compact
          disabled={pending}
          disabledReason={provider.model_count > 0 ? "Remove its models first." : undefined}
          onRemove={async () => {
            await deleteProvider(provider.id)
            if (mounted.current) onRemoved()
          }}
        >
          {(removing) => provider.kind === "openrouter" && <Button
            variant="ghost"
            size="icon"
            className="relative max-md:size-11"
            disabled={pending || removing}
            aria-label={`Refresh prices for ${provider.display_name}`}
            onClick={() => void refresh()}
          >
            <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden="true" />
            <span className="sr-only">Refresh prices</span>
          </Button>}
        </Removal>
        {pending && <p role="status" className="text-caption text-info">Refreshing prices…</p>}
        {message && <p role="status" className="text-caption text-success [overflow-wrap:anywhere]">
          {message}
        </p>}
        {error && <Alert variant="destructive" role="alert">
          {error}
        </Alert>}
        {provider.kind === "openrouter" && <p className="mt-1 max-w-[280px] font-mono text-data-sm text-fg-muted max-md:max-w-none">
          {formatOpenRouterLimits(limits)}
        </p>}
      </TableCell>
    </TableRow>
  )
}

function ProviderForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [kind, setKind] = useState<Provider>("ollama")
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434")
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const mounted = useMounted()
  const id = useId()
  const customUrl = ["ollama", "openai_compatible", "custom"].includes(kind)
  const keyRequired = ["openai", "openrouter", "anthropic", "gemini"].includes(kind)
  const urlRequired = kind === "openai_compatible" || kind === "custom"
  const valid = !!name.trim() && (!urlRequired || !!baseUrl.trim())
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy.current || !valid) return
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      const input: ProviderConfigurationInput = {
        display_name: name, kind, base_url: customUrl ? baseUrl || null : null,
        ...(kind !== "custom" && apiKey ? { api_key: apiKey } : {}),
      }
      await createProvider(input)
      if (mounted.current) onSaved()
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught))
    } finally {
      busy.current = false
      if (mounted.current) setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title="Add provider" description="API keys are encrypted and never shown again." footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button form={id} type="submit" disabled={saving || !valid}>
          {saving ? "Saving…" : "Save provider"}
        </Button>
      </>
    }>
      <form id={id} onSubmit={submit} className="space-y-3.5">
        {error && <Alert variant="destructive" role="alert">
          {error}
        </Alert>}
        <fieldset disabled={saving} className="min-w-0 space-y-3.5 border-0 p-0">
          <Field label="Display name">
            <Input
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="OpenAI work account"
            />
          </Field>
          <Field label="Provider kind">
            <Select
              value={kind}
              onChange={(event) => { setKind(event.target.value as Provider); setApiKey("") }}
            >
              {PROVIDERS.map((provider) => <option key={provider} value={provider}>
                {LABELS[provider]}
              </option>)}
            </Select>
          </Field>
          {customUrl ? <Field label={`Base URL (${urlRequired ? "required" : "optional"})`}>
            <Input
              className="font-mono"
              required={urlRequired}
              type="url"
              maxLength={2000}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field> : <p className="text-caption text-fg-muted">Uses the official endpoint.</p>}
          {kind !== "custom" ? <Field label={`API key (${keyRequired ? "required to run" : "optional where supported"})`}>
            <Input
              type="password"
              autoComplete="off"
              maxLength={10000}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </Field> : <p className="text-caption text-fg-muted">API key unsupported: custom endpoints cannot store credentials.</p>}
          {keyRequired && !apiKey.trim() && <p className="text-caption text-warning">⚠ Missing API key: this connection can be saved, but its models cannot run yet.</p>}
        </fieldset>
      </form>
    </Dialog>
  )
}

function ModelForm({
  providers,
  model,
  onSaved,
  onClose,
  focusPricing = false,
}: {
  providers: ProviderConfiguration[]
  model?: ModelConfiguration
  onClose: () => void
  focusPricing?: boolean
  onSaved: () => void
}) {
  const [name, setName] = useState(model?.display_name ?? "")
  const [providerId, setProviderId] = useState(String(model?.provider.id ?? providers[0]?.id ?? ""))
  const [modelName, setModelName] = useState(model?.model_name ?? "")
  const [parameters, setParameters] = useState(JSON.stringify(model?.parameters ?? {}, null, 2))
  const [active, setActive] = useState(model?.active ?? true)
  const initialProvider = providers.find((item) => String(item.id) === String(model?.provider.id ?? providers[0]?.id))
  const [pricingMode, setPricingMode] = useState<PricingSelection["mode"]>(normalizePricingMode(model?.pricing_mode ?? (model?.pricing?.source === "manual" ? "manual" : model?.pricing?.source === "catalog" ? "catalog" : model ? "unavailable" : initialProvider?.kind === "openrouter" ? "automatic" : "catalog"), initialProvider?.kind))
  const [inputPrice, setInputPrice] = useState(model?.pricing?.input_usd_per_million_tokens ?? "")
  const [outputPrice, setOutputPrice] = useState(model?.pricing?.output_usd_per_million_tokens ?? "")
  const [rpm, setRpm] = useState(model?.requests_per_minute?.toString() ?? "")
  const [maxConcurrent, setMaxConcurrent] = useState(model?.max_concurrent_requests?.toString() ?? "")
  const [pricingChanged, setPricingChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateIdentity(nextProviderId: string, nextModelName: string) {
    if (model && nextProviderId === String(model.provider.id) && nextModelName === model.model_name) {
      setPricingMode(normalizePricingMode(model.pricing_mode ?? (model.pricing?.source === "manual" ? "manual" : model.pricing?.source === "catalog" ? "catalog" : "unavailable"), model.provider.kind))
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

  const busy = useRef(false)
  const mounted = useMounted()
  const id = useId()
  const priceFocusRef = useRef<HTMLDivElement>(null)
  const parsed = parseParameters(parameters)
  const jsonValid = parsed !== null
  const automaticAvailable = providers.find((item) => String(item.id) === providerId)?.kind === "openrouter"
  const manualValid = validPrice(inputPrice) && validPrice(outputPrice)
  const knownPrice = !!model?.pricing && !pricingChanged
  const limitsValid = !automaticAvailable || (validLimit(rpm, 100000) && validLimit(maxConcurrent, 1000))
  const valid = !!name.trim() && !!modelName.trim() && !!providerId && jsonValid && limitsValid && (pricingMode !== "manual" || manualValid)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy.current || !valid || !parsed) return
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      const input: ModelConfigurationInput = {
        display_name: name,
        provider_id: Number(providerId),
        model_name: modelName,
        parameters: parsed,
        active,
        ...(automaticAvailable ? { requests_per_minute: rpm ? Number(rpm) : null, max_concurrent_requests: maxConcurrent ? Number(maxConcurrent) : null } : {}),
        ...(model && !pricingChanged ? {} : { pricing: pricingSelection(pricingMode, inputPrice, outputPrice) }),
      }
      if (model) await updateModel(model.id, input)
      else await createModel(input)
      if (mounted.current) onSaved()
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught))
    } finally {
      busy.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const options = [
    automaticAvailable
      ? { value: "automatic", label: "Automatic", disabled: saving }
      : { value: "catalog", label: "Catalog", disabled: saving },
    { value: "manual", label: "Manual", disabled: saving },
    { value: "unavailable", label: "Unavailable", disabled: saving },
  ]
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title={model ? "Edit model" : "Add model"} description="Models reuse a configured provider connection." initialFocusRef={focusPricing ? priceFocusRef : undefined} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button form={id} type="submit" disabled={saving || !valid}>
          {saving ? "Saving…" : "Save model"}
        </Button>
      </>
    }>
      <form id={id} className="space-y-3.5" onSubmit={submit}>
        {error && <Alert variant="destructive" role="alert">
          {error}
        </Alert>}
        <fieldset disabled={saving} className="min-w-0 space-y-3.5 border-0 p-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name">
              <Input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Model ID">
              <Input
                required
                className="font-mono"
                maxLength={300}
                value={modelName}
                onChange={(event) => updateIdentity(providerId, event.target.value)}
                placeholder="gpt-5.6-sol"
              />
            </Field>
          </div>
          <Field label="Provider">
            <Select value={providerId} onChange={(event) => updateIdentity(event.target.value, modelName)}>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>
                {provider.display_name} ·{" "}
                {LABELS[provider.kind]}
              </option>)}
            </Select>
          </Field>
          <Field
            label="Default parameters"
            error={!jsonValid ? "✕ not a valid JSON object" : undefined}
            hint={<span role="status" className="font-mono text-data-sm text-success">✓ valid JSON object</span>}
          >
            <Textarea
              className="font-mono"
              rows={4}
              value={parameters}
              onChange={(event) => setParameters(event.target.value)}
            />
          </Field>
          <div className="flex items-center gap-2.5">
            <Switch
              id={`${id}-active`}
              aria-label="Active"
              checked={active}
              onCheckedChange={setActive}
              disabled={saving}
            />
            <label htmlFor={`${id}-active`} className="text-body">Active{" "}
              <span className="text-fg-muted">· shown in New evaluation and Playground</span>
            </label>
          </div>
          {model && pricingChanged && (providerId !== String(model.provider.id) || modelName !== model.model_name) && <p className="text-caption text-fg-muted">Changing the provider or model ID resets pricing to automatic OpenRouter pricing or the built-in catalog, depending on the selected provider.</p>}
          <fieldset className="min-w-0 space-y-3 rounded-md border border-line p-3">
            <legend className="px-1 text-caption font-medium">Pricing{" "}
              <span className="font-normal text-fg-muted">· USD per 1M tokens, optional</span>
            </legend>
            <div ref={priceFocusRef} tabIndex={-1}>
              <SegmentedControl
                mode="radio"
                label="Pricing basis"
                options={options}
                value={pricingMode}
                onValueChange={(value) => { setPricingMode(value as PricingSelection["mode"]); setPricingChanged(true) }}
              />
            </div>
            {pricingMode === "manual" && <div className="grid gap-3 sm:grid-cols-2">
              <PriceInput
                label="Input USD / 1M tokens"
                value={inputPrice}
                onChange={(value) => { setInputPrice(value); setPricingChanged(true) }}
              />
              <PriceInput
                label="Output USD / 1M tokens"
                value={outputPrice}
                onChange={(value) => { setOutputPrice(value); setPricingChanged(true) }}
              />
            </div>}
            <p
              role="status"
              className={`text-caption ${pricingMode === "manual" ? manualValid ? "text-success" : "text-destructive" : knownPrice ? "text-success" : "text-warning"}`}
            >
              {pricingMode === "manual" ? manualValid ? "✓ Cost will be estimated for new runs." : "Add both input and output prices between $0 and $1,000, with at most 6 decimal places." : knownPrice ? "✓ Cost will be estimated for new runs." : pricingMode === "unavailable" ? "No price yet: runs will show this model’s cost as unpriced." : "Pricing is resolved when saved. Runs show cost as unpriced if no catalog or automatic price is available."}
            </p>
            <p className="text-caption text-fg-muted">Unknown catalog models remain runnable. Explicit rates can include zero.</p>
          </fieldset>
          {automaticAvailable && <fieldset className="min-w-0 space-y-3 rounded-md border border-line p-3">
            <legend className="px-1 text-caption font-medium">Limits</legend>
            <p className="text-caption text-fg-muted">OpenRouter does not publish dependable per-model quotas. These controls apply to requests from this dashboard.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Requests per minute"
                error={!validLimit(rpm, 100000) ? "Enter a whole number from 1 to 100,000." : undefined}
              >
                <Input
                  className="font-mono"
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={rpm}
                  onChange={(event) => setRpm(event.target.value)}
                  placeholder="No limit"
                />
              </Field>
              <Field
                label="Concurrent requests"
                error={!validLimit(maxConcurrent, 1000) ? "Enter a whole number from 1 to 1,000." : undefined}
              >
                <Input
                  className="font-mono"
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  value={maxConcurrent}
                  onChange={(event) => setMaxConcurrent(event.target.value)}
                  placeholder="No limit"
                />
              </Field>
            </div>
          </fieldset>}
        </fieldset>
      </form>
    </Dialog>
  )
}

function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <Input
        required
        className="font-mono"
        type="number"
        min="0"
        max="1000"
        step="0.000001"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function parseParameters(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch { return null }
}
function validPrice(value: string) {
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return false
  const [mantissa, exponent = "0"] = value.toLowerCase().split("e")
  const decimalPlaces = (mantissa.split(".")[1]?.length ?? 0) - Number(exponent)
  return decimalPlaces <= 6 && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1000
}
function validLimit(value: string, max: number) {
  return value === "" || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max)
}
function ModelLimits({ model }: { model: ModelConfiguration }) {
  const hasRpm = model.requests_per_minute != null
  const hasConcurrent = model.max_concurrent_requests != null
  return (
    <div className="font-mono text-data">
      {!hasRpm && !hasConcurrent && <span className="hidden text-fg-muted md:inline">—</span>}
      {hasRpm && <>{formatInt(model.requests_per_minute)}<span className="text-fg-muted">/min</span></>}
      {hasRpm && hasConcurrent && <span className="text-fg-muted"> · </span>}
      {hasConcurrent && <>{formatInt(model.max_concurrent_requests)}<span className="text-fg-muted"> concurrent</span></>}
    </div>
  )
}

function normalizePricingMode(mode: PricingSelection["mode"], kind?: Provider): PricingSelection["mode"] {
  return kind === "openrouter" && mode === "catalog" ? "automatic" : mode
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

function formatOpenRouterLimits(limits?: OpenRouterLimits) {
  if (!limits) return "Free-model daily quota unknown"
  if (!limits.supported) return "Quota metadata unavailable for this endpoint."
  if (!limits.available) return "Quota unknown · OpenRouter account metadata unavailable."
  const daily = limits.free_model_daily_requests
  const quota = daily && daily.remaining != null && daily.limit != null ? `Free-model requests: ${formatInt(daily.remaining)} of ${formatInt(daily.limit)} remaining today` : "Free-model daily quota unknown"
  return `${quota} · ${limits.limit_remaining_usd == null ? "Remaining credit unknown" : `${formatUsd(limits.limit_remaining_usd)} credit left`}`
}
function compactEndpoint(baseUrl: string | null) {
  if (!baseUrl) return "Official endpoint"
  try {
    const parsed = new URL(baseUrl)
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.host : baseUrl
  } catch {
    return baseUrl
  }
}

function credentialLabel(provider: ProviderConfiguration) {
  if (provider.has_api_key) return (
    <>✓ <span className="md:hidden">key </span>set<span className="hidden md:inline"> · write-only</span></>
  )
  if (provider.api_key_requirement === "required") return "⚠ missing"
  return provider.api_key_requirement === "unsupported" ? "none needed" : "optional"
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}
