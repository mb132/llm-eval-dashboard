import { ArrowUpRight } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, useParams } from "react-router-dom"

import {
  createPromptVersion,
  getPrompt,
  updatePrompt,
  type PromptDetail,
} from "@/api/prompts"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { Alert } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InsetPane } from "@/components/ui/inset-pane"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime, formatInt } from "@/lib/format"
import { validatePromptContent, validateSystemPrompt } from "@/lib/prompt"

export function PromptDetailPage() {
  const { promptId } = useParams()
  const [prompt, setPrompt] = useState<PromptDetail | null>(null)
  const [selectedId, setSelectedId] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [versionContent, setVersionContent] = useState("")
  const [versionSystemPrompt, setVersionSystemPrompt] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [metadataSuccess, setMetadataSuccess] = useState("")
  const [versionSuccess, setVersionSuccess] = useState("")
  const [pending, setPending] = useState<"metadata" | "version" | null>(null)
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  const mutation = useRef(false)

  useEffect(() => {
    const request = ++generation.current
    let current = true
    mutation.current = false
    setPrompt(null)
    setIsLoading(true)
    setPageError(null)
    setMetadataError(null)
    setVersionError(null)
    setMetadataSuccess("")
    setVersionSuccess("")
    setPending(null)
    if (!promptId) {
      setPageError("Prompt not found.")
      setIsLoading(false)
      return () => {
        current = false
        generation.current++
      }
    }
    getPrompt(promptId)
      .then((result) => {
        if (!current || request !== generation.current) return
        const latest = [...result.versions].sort(
          (a, b) => b.version_number - a.version_number,
        )[0]
        setPrompt(result)
        setName(result.name)
        setDescription(result.description ?? "")
        setVersionContent(latest?.content ?? "")
        setVersionSystemPrompt(latest?.system_prompt ?? "")
        setSelectedId(latest?.id ?? "")
      })
      .catch((error: unknown) => {
        if (current)
          setPageError(
            error instanceof Error ? error.message : "Could not load prompt.",
          )
      })
      .finally(() => {
        if (current) setIsLoading(false)
      })
    return () => {
      current = false
      generation.current++
    }
  }, [promptId, reload])

  const versions = [...(prompt?.versions ?? [])].sort(
    (a, b) => b.version_number - a.version_number,
  )
  const latest = versions[0]
  const selected =
    versions.find((version) => version.id === selectedId) ?? latest
  const nextNumber = (latest?.version_number ?? 0) + 1
  const contentError = validatePromptContent(versionContent)
  const systemError = validateSystemPrompt(versionSystemPrompt)
  const count = (versionContent.match(/{{input}}/g) ?? []).length
  const validation =
    count === 0
      ? "Add {{input}} where each test case input goes."
      : count > 1
        ? `✕ {{input}} appears ${count} times. Use it once.`
        : contentError
          ? `✕ ${contentError}`
          : "✓ {{input}} appears once"
  const changed =
    Boolean(latest) &&
    (versionContent !== latest?.content ||
      versionSystemPrompt !== (latest?.system_prompt ?? ""))
  const metadataChanged =
    Boolean(prompt) &&
    (name.trim() !== prompt?.name ||
      (description.trim() || null) !== prompt?.description)
  const canCreate = Boolean(
    promptId && prompt && changed && !contentError && !systemError,
  )
  const busy = Boolean(pending)

  function resetDraft() {
    if (!latest || mutation.current) return
    setVersionContent(latest.content)
    setVersionSystemPrompt(latest.system_prompt ?? "")
    setVersionError(null)
    setVersionSuccess("")
  }

  async function handleMetadataSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !promptId ||
      !prompt ||
      !name.trim() ||
      !metadataChanged ||
      mutation.current
    )
      return
    const request = generation.current
    mutation.current = true
    setPending("metadata")
    setMetadataError(null)
    setMetadataSuccess("")
    try {
      const updated = await updatePrompt(promptId, {
        name: name.trim(),
        description: description.trim() || null,
      })
      if (request !== generation.current) return
      setPrompt(updated)
      setName(updated.name)
      setDescription(updated.description ?? "")
      setMetadataSuccess("Prompt details saved.")
    } catch (error) {
      if (request === generation.current)
        setMetadataError(
          error instanceof Error ? error.message : "Could not save prompt.",
        )
    } finally {
      if (request === generation.current) {
        mutation.current = false
        setPending(null)
      }
    }
  }

  async function handleVersionSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!promptId || !canCreate || mutation.current) return
    const request = generation.current
    mutation.current = true
    setPending("version")
    setVersionError(null)
    setVersionSuccess("")
    try {
      const version = await createPromptVersion(
        promptId,
        versionContent,
        versionSystemPrompt || null,
      )
      if (request !== generation.current) return
      setPrompt((previous) =>
        previous
          ? {
              ...previous,
              updated_at: version.created_at,
              versions: [version, ...previous.versions],
            }
          : previous,
      )
      setVersionContent(version.content)
      setVersionSystemPrompt(version.system_prompt ?? "")
      setSelectedId(version.id)
      setVersionSuccess(`Version ${version.version_number} created.`)
    } catch (error) {
      if (request === generation.current)
        setVersionError(
          error instanceof Error ? error.message : "Could not create version.",
        )
    } finally {
      if (request === generation.current) {
        mutation.current = false
        setPending(null)
      }
    }
  }

  const evaluate = (
    <Link
      to="/evaluations/new"
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      <ArrowUpRight aria-hidden="true" />
      Evaluate this prompt
    </Link>
  )
  const title =
    prompt?.name ??
    (/not found/i.test(pageError ?? "") ? "Prompt not found" : "Prompt")

  return (
    <PageFrame
      breadcrumbs={[{ label: "Prompts", to: "/prompts" }, { label: title }]}
      mobileTitle="Prompts"
      mobileBack={{ label: "Prompts", to: "/prompts" }}
      actions={prompt ? evaluate : undefined}
    >
      <PageHeader
        title={title}
        metadata={
          prompt && (
            <>
              <span>
                Latest{" "}
                <span className="font-mono text-fg">
                  v{latest?.version_number ?? "—"}
                </span>
              </span>
              <span className="font-mono">
                {formatInt(versions.length)}{" "}
                {versions.length === 1 ? "version" : "versions"}
              </span>
              <span className="font-mono [overflow-wrap:anywhere]">
                Updated{" "}
                <time dateTime={prompt.updated_at}>
                  {formatDateTime(prompt.updated_at)}
                </time>
              </span>
            </>
          )
        }
      />
      {isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle>Versions</CardTitle>
          </CardHeader>
          <LoadingState label="Loading prompt…" />
        </Card>
      ) : pageError || !prompt ? (
        <Card>
          <CardContent className="space-y-4">
            <ErrorState
              message={pageError ?? "Prompt not found."}
              onRetry={() => setReload((value) => value + 1)}
            />
            <Link
              to="/prompts"
              className={buttonVariants({ variant: "outline", size: "touch" })}
            >
              Back to prompts
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <Link
            to="/evaluations/new"
            className={`${buttonVariants({ variant: "outline", size: "touch" })} md:hidden`}
          >
            Evaluate this prompt
          </Link>
          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Versions</CardTitle>
                  {versions.length > 6 ? (
                    <Field
                      label="Version"
                      htmlFor="selected-version"
                      className="w-full md:w-48"
                    >
                      <Select
                        className="font-mono"
                        id="selected-version"
                        value={selected?.id ?? ""}
                        onChange={(event) => setSelectedId(event.target.value)}
                      >
                        {versions.map((version) => (
                          <option key={version.id} value={version.id}>
                            v{version.version_number}
                            {version.id === latest?.id ? " · latest" : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : (
                    <SegmentedControl
                      className="font-mono"
                      id="prompt-versions"
                      label="Prompt versions"
                      value={selected?.id ?? ""}
                      onValueChange={setSelectedId}
                      options={versions.map((version) => ({
                        value: version.id,
                        label: `v${version.version_number}${version.id === latest?.id ? " latest" : ""}`,
                      }))}
                    />
                  )}
                  {selected && (
                    <time
                      className="ml-auto font-mono text-data-sm text-fg-muted [overflow-wrap:anywhere]"
                      dateTime={selected.created_at}
                    >
                      {formatDateTime(selected.created_at)}
                    </time>
                  )}
                </CardHeader>
                <CardContent>
                  {selected ? (
                    <div
                      id={`prompt-versions-${selected.id}-panel`}
                      role={versions.length <= 6 ? "tabpanel" : undefined}
                      aria-labelledby={
                        versions.length <= 6
                          ? `prompt-versions-${selected.id}-tab`
                          : undefined
                      }
                      tabIndex={0}
                      className="grid min-w-0 gap-px overflow-hidden rounded-md border border-line-strong bg-line-strong"
                    >
                      <InsetPane label="User template" mono>
                        {selected.content}
                      </InsetPane>
                      <InsetPane label="System prompt" mono>
                        {selected.system_prompt || (
                          <span className="text-fg-muted">none</span>
                        )}
                      </InsetPane>
                    </div>
                  ) : (
                    <EmptyState title="No versions yet" />
                  )}
                </CardContent>
              </Card>
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Create version {nextNumber}</CardTitle>
                  <CardDescription>
                    Starts from v{latest?.version_number ?? "—"}. Saving creates
                    an immutable v{nextNumber}; earlier runs keep v
                    {latest?.version_number ?? "—"}.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {versionSuccess && (
                    <Alert variant="success" className="mb-4">
                      {versionSuccess}
                    </Alert>
                  )}
                  <form
                    className="space-y-4"
                    onSubmit={handleVersionSave}
                    noValidate
                  >
                    <fieldset disabled={busy} className="min-w-0 space-y-4">
                      <Field
                        label="System prompt"
                        htmlFor="version-system-prompt"
                        optional
                        hint="Sent separately from the user message. Leave empty to remove. Placeholders are not supported here."
                        error={systemError}
                      >
                        <Textarea
                          id="version-system-prompt"
                          className="font-mono"
                          rows={3}
                          value={versionSystemPrompt}
                          maxLength={20_000}
                          onChange={(event) =>
                            setVersionSystemPrompt(event.target.value)
                          }
                        />
                      </Field>
                      <Field label="User template" htmlFor="version-content">
                        <Textarea
                          id="version-content"
                          rows={12}
                          className="font-mono md:h-[198px]"
                          value={versionContent}
                          maxLength={20_000}
                          aria-invalid={Boolean(contentError)}
                          aria-describedby="version-validation"
                          onChange={(event) =>
                            setVersionContent(event.target.value)
                          }
                          required
                        />
                      </Field>
                      <div
                        id="version-validation"
                        role="status"
                        aria-live="polite"
                        className="space-y-1 font-mono text-data-sm"
                      >
                        <p
                          className={
                            count === 0
                              ? "text-fg-muted"
                              : contentError
                                ? "text-destructive"
                                : "text-success"
                          }
                        >
                          {validation}
                        </p>
                        <p className="text-fg-muted">
                          {changed
                            ? `Changed from v${latest?.version_number}`
                            : `No changes from v${latest?.version_number} yet`}
                        </p>
                      </div>
                      {contentError && count === 0 && (
                        <p className="text-caption text-fg-muted">
                          {contentError}
                        </p>
                      )}
                      {versionError && (
                        <Alert variant="destructive">{versionError}</Alert>
                      )}
                      <div className="flex flex-wrap gap-2 max-md:flex-col">
                        <Button
                          type="submit"
                          disabled={!canCreate || busy}
                          className="max-md:h-12"
                        >
                          {pending === "version"
                            ? "Creating…"
                            : `Create version ${nextNumber}`}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={!changed || busy}
                          onClick={resetDraft}
                          className="max-md:h-11"
                        >
                          Reset to v{latest?.version_number ?? "—"}
                        </Button>
                      </div>
                    </fieldset>
                  </form>
                </CardContent>
              </Card>
            </div>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Details</CardTitle>
                <CardDescription>
                  Name and description don't create a version.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {metadataSuccess && (
                  <Alert variant="success" className="mb-4">
                    {metadataSuccess}
                  </Alert>
                )}
                <form
                  className="space-y-4"
                  onSubmit={handleMetadataSave}
                  noValidate
                >
                  <fieldset disabled={busy} className="min-w-0 space-y-4">
                    <Field label="Name" htmlFor="detail-name">
                      <Input
                        id="detail-name"
                        value={name}
                        maxLength={120}
                        onChange={(event) => setName(event.target.value)}
                        required
                      />
                    </Field>
                    <Field
                      label="Description"
                      htmlFor="detail-description"
                      optional
                    >
                      <Textarea
                        id="detail-description"
                        rows={4}
                        className="font-sans [overflow-wrap:anywhere]"
                        value={description}
                        maxLength={500}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </Field>
                    {!name.trim() && (
                      <p className="text-caption text-fg-muted">
                        Enter a prompt name.
                      </p>
                    )}
                    {metadataError && (
                      <Alert variant="destructive">{metadataError}</Alert>
                    )}
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={busy || !metadataChanged || !name.trim()}
                      className="w-full max-md:h-11"
                    >
                      {pending === "metadata" ? "Saving…" : "Save details"}
                    </Button>
                  </fieldset>
                </form>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageFrame>
  )
}
