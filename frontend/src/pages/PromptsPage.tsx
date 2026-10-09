import { AlertCircle, LoaderCircle, Plus } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"

import {
  createPrompt,
  listPrompts,
  type PromptSummary,
} from "@/api/prompts"
import { Alert } from "@/components/ui/alert"
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
import { validatePromptContent, validateSystemPrompt } from "@/lib/prompt"

export function PromptsPage() {
  const navigate = useNavigate()
  const [prompts, setPrompts] = useState<PromptSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [content, setContent] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    let active = true
    listPrompts()
      .then((items) => {
        if (active) setPrompts(items)
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "Could not load prompts.")
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) {
      setFormError("Prompt name is required.")
      return
    }
    const contentError = validatePromptContent(content)
    if (contentError) {
      setFormError(contentError)
      return
    }
    const systemPromptError = validateSystemPrompt(systemPrompt)
    if (systemPromptError) {
      setFormError(systemPromptError)
      return
    }

    setIsCreating(true)
    setFormError(null)
    try {
      const prompt = await createPrompt({
        name: cleanName,
        description: description.trim() || null,
        content,
        system_prompt: systemPrompt || null,
      })
      navigate(`/prompts/${prompt.id}`)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create prompt.")
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <Badge variant="secondary">Prompt management</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Prompts
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Create reusable prompt templates and preserve every content version.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
        <section aria-labelledby="saved-prompts-heading">
          <h2 id="saved-prompts-heading" className="mb-3 text-lg font-semibold">
            Saved prompts
          </h2>
          {isLoading && (
            <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Loading prompts…
            </div>
          )}
          {loadError && <ErrorMessage message={loadError} />}
          {!isLoading && !loadError && prompts.length === 0 && (
            <div className="rounded-xl border border-dashed bg-card p-8 text-center">
              <p className="font-medium">No prompts yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create the first versioned prompt with the form on this page.
              </p>
            </div>
          )}
          {!isLoading && !loadError && prompts.length > 0 && (
            <ul className="space-y-3">
              {prompts.map((prompt) => (
                <li key={prompt.id}>
                  <Link
                    to={`/prompts/${prompt.id}`}
                    className="block rounded-xl border bg-card p-5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold">{prompt.name}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {prompt.description || "No description"}
                        </p>
                      </div>
                      <Badge variant="outline">Version {prompt.latest_version_number}</Badge>
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground">
                      Updated {formatDate(prompt.updated_at)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="create-prompt-heading">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>
                <h2 id="create-prompt-heading">Create prompt</h2>
              </CardTitle>
              <CardDescription>
                Creating a prompt also creates its immutable first version.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleCreate} noValidate>
                <FormField label="Name" htmlFor="prompt-name">
                  <Input
                    id="prompt-name"
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </FormField>
                <FormField label="Description" htmlFor="prompt-description" optional>
                  <Textarea
                    id="prompt-description"
                    className="min-h-20 font-sans"
                    value={description}
                    maxLength={500}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </FormField>
                <FormField label="System prompt" htmlFor="prompt-system-prompt" optional>
                  <Textarea
                    id="prompt-system-prompt"
                    value={systemPrompt}
                    maxLength={20_000}
                    aria-describedby="prompt-system-help"
                    onChange={(event) => setSystemPrompt(event.target.value)}
                  />
                  <p id="prompt-system-help" className="text-xs text-muted-foreground">
                    Optional instructions sent separately from the user message. Do not
                    use placeholders here.
                  </p>
                </FormField>
                <FormField label="User prompt template" htmlFor="prompt-content">
                  <Textarea
                    id="prompt-content"
                    value={content}
                    maxLength={20_000}
                    aria-describedby="prompt-content-help"
                    onChange={(event) => setContent(event.target.value)}
                    required
                  />
                  <p id="prompt-content-help" className="text-xs text-muted-foreground">
                    Include <code>{"{{input}}"}</code> exactly once. It will be replaced
                    with each test case input during evaluation.
                  </p>
                </FormField>

                {formError && <ErrorMessage message={formError} />}
                <Button type="submit" disabled={isCreating} className="w-full">
                  {isCreating ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {isCreating ? "Creating…" : "Create prompt"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

function FormField({
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
    <Alert variant="destructive" className="flex gap-2" role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </Alert>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
