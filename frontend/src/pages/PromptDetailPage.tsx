import { AlertCircle, ArrowLeft, LoaderCircle, Save } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { Link, useParams } from "react-router-dom"

import {
  createPromptVersion,
  getPrompt,
  updatePrompt,
  type PromptDetail,
} from "@/api/prompts"
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
import { Textarea } from "@/components/ui/textarea"
import { validatePromptContent } from "@/lib/prompt"

export function PromptDetailPage() {
  const { promptId } = useParams()
  const [prompt, setPrompt] = useState<PromptDetail | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [versionContent, setVersionContent] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState("")
  const [isSavingMetadata, setIsSavingMetadata] = useState(false)
  const [isSavingVersion, setIsSavingVersion] = useState(false)

  useEffect(() => {
    let active = true
    if (!promptId) {
      setPageError("Prompt not found.")
      setIsLoading(false)
      return
    }
    getPrompt(promptId)
      .then((result) => {
        if (!active) return
        setPrompt(result)
        setName(result.name)
        setDescription(result.description ?? "")
        setVersionContent(result.versions[0]?.content ?? "")
      })
      .catch((error: unknown) => {
        if (active) {
          setPageError(error instanceof Error ? error.message : "Could not load prompt.")
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [promptId])

  async function handleMetadataSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!promptId || !name.trim()) {
      setMetadataError("Prompt name is required.")
      return
    }
    setIsSavingMetadata(true)
    setMetadataError(null)
    setStatusMessage("")
    try {
      const updated = await updatePrompt(promptId, {
        name: name.trim(),
        description: description.trim() || null,
      })
      setPrompt(updated)
      setName(updated.name)
      setDescription(updated.description ?? "")
      setStatusMessage("Prompt details saved.")
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : "Could not save prompt.")
    } finally {
      setIsSavingMetadata(false)
    }
  }

  async function handleVersionSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!promptId || !prompt) return
    const contentError = validatePromptContent(versionContent)
    if (contentError) {
      setVersionError(contentError)
      return
    }
    setIsSavingVersion(true)
    setVersionError(null)
    setStatusMessage("")
    try {
      const version = await createPromptVersion(promptId, versionContent)
      setPrompt({
        ...prompt,
        updated_at: version.created_at,
        versions: [version, ...prompt.versions],
      })
      setStatusMessage(`Version ${version.version_number} created.`)
    } catch (error) {
      setVersionError(error instanceof Error ? error.message : "Could not create version.")
    } finally {
      setIsSavingVersion(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading prompt…
      </div>
    )
  }

  if (pageError || !prompt) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorMessage message={pageError ?? "Prompt not found."} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <BackLink />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge variant="secondary">Versioned prompt</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {prompt.name}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Update metadata or create a new immutable content version.
          </p>
        </div>
        <Badge variant="outline">
          {prompt.versions.length} {prompt.versions.length === 1 ? "version" : "versions"}
        </Badge>
      </header>

      {statusMessage && (
        <p
          className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
          role="status"
        >
          {statusMessage}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Prompt details</CardTitle>
            <CardDescription>
              Metadata changes do not create a content version.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleMetadataSave} noValidate>
              <Field label="Name" htmlFor="detail-name">
                <Input
                  id="detail-name"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </Field>
              <Field label="Description" htmlFor="detail-description" optional>
                <Textarea
                  id="detail-description"
                  className="min-h-24 font-sans"
                  value={description}
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
              {metadataError && <ErrorMessage message={metadataError} />}
              <Button type="submit" disabled={isSavingMetadata}>
                {isSavingMetadata ? (
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                ) : (
                  <Save className="mr-2 size-4" />
                )}
                {isSavingMetadata ? "Saving…" : "Save details"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Create new version</CardTitle>
            <CardDescription>
              The latest content is prefilled. Saving creates the next version.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleVersionSave} noValidate>
              <Field label="Prompt template" htmlFor="version-content">
                <Textarea
                  id="version-content"
                  className="min-h-48"
                  value={versionContent}
                  maxLength={20_000}
                  aria-describedby="version-content-help"
                  onChange={(event) => setVersionContent(event.target.value)}
                  required
                />
                <p id="version-content-help" className="text-xs text-muted-foreground">
                  Include <code>{"{{input}}"}</code> exactly once. It will be replaced
                  with each test case input during evaluation.
                </p>
              </Field>
              {versionError && <ErrorMessage message={versionError} />}
              <Button type="submit" disabled={isSavingVersion}>
                {isSavingVersion ? (
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                ) : (
                  <Save className="mr-2 size-4" />
                )}
                {isSavingVersion ? "Creating…" : "Create version"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="version-history-heading">
        <h2 id="version-history-heading" className="text-xl font-semibold">
          Version history
        </h2>
        <div className="mt-4 space-y-4">
          {prompt.versions.map((version) => (
            <article key={version.id} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">Version {version.version_number}</h3>
                <time className="text-xs text-muted-foreground" dateTime={version.created_at}>
                  {formatDate(version.created_at)}
                </time>
              </div>
              <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-4 font-mono text-sm leading-relaxed">
                {version.content}
              </pre>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/prompts"
      className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
    >
      <ArrowLeft className="size-4" />
      Back to prompts
    </Link>
  )
}

function Field({
  label,
  htmlFor,
  optional = false,
  children,
}: {
  label: string
  htmlFor: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="flex items-center justify-between text-sm font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">Optional</span>}
      </label>
      {children}
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
