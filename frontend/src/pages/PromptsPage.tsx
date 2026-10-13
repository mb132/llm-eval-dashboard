import { ChevronRight } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"

import {
  createPrompt,
  getPrompt,
  listPrompts,
  type PromptDetail,
  type PromptSummary,
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
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime, formatInt, formatShortDate } from "@/lib/format"
import { validatePromptContent, validateSystemPrompt } from "@/lib/prompt"

export function PromptsPage() {
  const navigate = useNavigate()
  const [prompts, setPrompts] = useState<PromptSummary[]>([])
  const [details, setDetails] = useState<Record<string, PromptDetail>>({})
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [detailRetry, setDetailRetry] = useState(0)
  const [search, setSearch] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [content, setContent] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const active = useRef(false)
  const creating = useRef(false)

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    let current = true
    setIsLoading(true)
    setLoadError(null)
    listPrompts()
      .then((items) => {
        if (current) setPrompts(items)
      })
      .catch((error: unknown) => {
        if (current)
          setLoadError(
            error instanceof Error ? error.message : "Could not load prompts.",
          )
      })
      .finally(() => {
        if (current) setIsLoading(false)
      })
    return () => {
      current = false
    }
  }, [reload])

  useEffect(() => {
    let current = true
    setDetailErrors({})
    // Summary data stays interactive while complete template history loads.
    for (const item of prompts) {
      getPrompt(item.id)
        .then((result) => {
          if (current)
            setDetails((previous) => ({ ...previous, [item.id]: result }))
        })
        .catch((error: unknown) => {
          if (current)
            setDetailErrors((previous) => ({
              ...previous,
              [item.id]:
                error instanceof Error
                  ? error.message
                  : "Could not load template contents.",
            }))
        })
    }
    return () => {
      current = false
    }
  }, [prompts, detailRetry])

  const contentError = validatePromptContent(content)
  const systemError = validateSystemPrompt(systemPrompt)
  const count = (content.match(/{{input}}/g) ?? []).length
  const validation =
    count === 0
      ? "Add {{input}} where each test case input goes."
      : count > 1
        ? `✕ {{input}} appears ${count} times. Use it once.`
        : contentError
          ? `✕ ${contentError}`
          : "✓ {{input}} appears once"
  const canCreate = Boolean(name.trim()) && !contentError && !systemError
  const incomplete = prompts.filter((item) => !details[item.id]).length
  const failed = Object.keys(detailErrors).length > 0
  const query = search.trim().toLowerCase()
  const visible = prompts.filter(
    (item) =>
      !query ||
      item.name.toLowerCase().includes(query) ||
      details[item.id]?.versions.some(
        (version) =>
          version.content.toLowerCase().includes(query) ||
          version.system_prompt?.toLowerCase().includes(query),
      ),
  )
  const versions = prompts.reduce(
    (total, item) => total + (details[item.id]?.versions.length ?? 0),
    0,
  )

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canCreate || creating.current) return
    creating.current = true
    setIsCreating(true)
    setFormError(null)
    try {
      const result = await createPrompt({
        name: name.trim(),
        description: description.trim() || null,
        content,
        system_prompt: systemPrompt || null,
      })
      if (active.current) navigate(`/prompts/${result.id}`)
    } catch (error) {
      if (active.current)
        setFormError(
          error instanceof Error ? error.message : "Could not create prompt.",
        )
    } finally {
      creating.current = false
      if (active.current) setIsCreating(false)
    }
  }

  return (
    <PageFrame
      breadcrumbs={[{ label: "Prompts" }]}
      mobileTitle="Prompts"
      actions={
        <span className="text-caption text-fg-muted">
          Every content change creates a new immutable version.
        </span>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title="Prompts"
          metadata={
            <span className="font-mono">
              {isLoading
                ? "Loading counts…"
                : `${formatInt(prompts.length)} ${prompts.length === 1 ? "prompt" : "prompts"} · ${incomplete ? "versions pending" : `${formatInt(versions)} ${versions === 1 ? "version" : "versions"}`}`}
            </span>
          }
        />
        <Field
          label="Search prompts"
          htmlFor="prompt-search"
          className="w-full md:w-72"
        >
          <Input
            id="prompt-search"
            type="search"
            placeholder="Name or template text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
      </div>
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Saved prompts</CardTitle>
          </CardHeader>
          {isLoading ? (
            <LoadingState label="Loading prompts…" />
          ) : loadError ? (
            <CardContent>
              <ErrorState
                message={loadError}
                onRetry={() => setReload((value) => value + 1)}
              />
            </CardContent>
          ) : (
            <>
              {incomplete > 0 && (
                <CardContent>
                  {failed ? (
                    <ErrorState
                      message={`Template search and version count are incomplete. ${Object.values(detailErrors).join(" ")}`}
                      onRetry={() => setDetailRetry((value) => value + 1)}
                    />
                  ) : (
                    <p role="status" className="text-caption text-fg-muted">
                      Loading template search and version counts for{" "}
                      {formatInt(incomplete)} prompts…
                    </p>
                  )}
                </CardContent>
              )}
              {prompts.length === 0 ? (
                <EmptyState
                  title="No prompts yet"
                  description="Create one to start evaluating."
                  action={
                    <Button
                      variant="outline"
                      className="max-md:h-11"
                      onClick={() => nameInput.current?.focus()}
                    >
                      Create first prompt
                    </Button>
                  }
                />
              ) : visible.length === 0 ? (
                <EmptyState
                  title={
                    incomplete
                      ? "No matches in loaded prompts yet"
                      : "No prompts match this search"
                  }
                  description={
                    incomplete
                      ? "Template search is incomplete. Results may appear when templates load."
                      : "Try another name or template phrase."
                  }
                />
              ) : (
                <>
                  <div className="hidden md:block">
                    <Table className="min-w-[560px]" aria-label="Saved prompts">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Prompt</TableHead>
                          <TableHead>Latest</TableHead>
                          <TableHead>Updated</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visible.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="max-w-80">
                              <Link
                                className="text-body font-medium text-link [overflow-wrap:anywhere]"
                                to={`/prompts/${item.id}`}
                              >
                                {item.name}
                              </Link>
                              <p className="mt-1 text-caption text-fg-muted [overflow-wrap:anywhere]">
                                {item.description || "No description"}
                              </p>
                            </TableCell>
                            <TableCell className="font-mono">
                              v{item.latest_version_number}
                            </TableCell>
                            <TableCell className="font-mono">
                              <time
                                dateTime={item.updated_at}
                                title={formatDateTime(item.updated_at)}
                              >
                                {
                                  formatShortDate(item.updated_at).split(
                                    "\n",
                                  )[0]
                                }
                                <span className="block text-fg-muted">
                                  {
                                    formatShortDate(item.updated_at).split(
                                      "\n",
                                    )[1]
                                  }
                                </span>
                              </time>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                <Link
                                  className={buttonVariants({
                                    variant: "ghost",
                                    size: "xs",
                                  })}
                                  to="/evaluations/new"
                                >
                                  Evaluate
                                </Link>
                                <Link
                                  className={buttonVariants({
                                    variant: "outline",
                                    size: "xs",
                                  })}
                                  to={`/prompts/${item.id}`}
                                >
                                  Open
                                </Link>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <ul className="divide-y divide-line md:hidden">
                    {visible.map((item) => (
                      <li key={item.id}>
                        <Link
                          to={`/prompts/${item.id}`}
                          className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-hover"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="text-body font-medium [overflow-wrap:anywhere]">
                              {item.name}
                            </span>
                            <p className="mt-1 line-clamp-2 text-caption text-fg-muted [overflow-wrap:anywhere]">
                              {item.description || "No description"}
                            </p>
                            <p className="mt-2 font-mono text-data-sm text-fg-muted">
                              v{item.latest_version_number} ·{" "}
                              {formatShortDate(item.updated_at).replace(
                                "\n",
                                " · ",
                              )}
                            </p>
                          </div>
                          <ChevronRight
                            className="size-4 shrink-0 text-fg-muted"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>New prompt</CardTitle>
            <CardDescription>
              Creating a prompt also creates its first version, v1.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              id="create-prompt"
              className="space-y-4"
              onSubmit={handleCreate}
              noValidate
            >
              <fieldset disabled={isCreating} className="min-w-0 space-y-4">
                <Field label="Name" htmlFor="prompt-name">
                  <Input
                    ref={nameInput}
                    id="prompt-name"
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </Field>
                <Field
                  label="Description"
                  htmlFor="prompt-description"
                  optional
                >
                  <Textarea
                    id="prompt-description"
                    rows={3}
                    className="font-sans [overflow-wrap:anywhere]"
                    value={description}
                    maxLength={500}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
                <Field
                  label="System prompt"
                  htmlFor="prompt-system-prompt"
                  optional
                  hint="Sent separately from the user message. Placeholders are not supported here."
                  error={systemError}
                >
                  <Textarea
                    id="prompt-system-prompt"
                    className="font-mono"
                    rows={3}
                    value={systemPrompt}
                    maxLength={20_000}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                  />
                </Field>
                <Field
                  label="User template"
                  htmlFor="prompt-content"
                  hint="It will be replaced with each test case input during evaluation."
                >
                  <Textarea
                    id="prompt-content"
                    className="font-mono"
                    rows={5}
                    value={content}
                    maxLength={20_000}
                    aria-invalid={Boolean(contentError) && content.length > 0}
                    aria-describedby="prompt-validation"
                    onChange={(event) => setContent(event.target.value)}
                    required
                  />
                </Field>
                <p
                  id="prompt-validation"
                  role="status"
                  aria-live="polite"
                  className={`font-mono text-data-sm ${count === 0 ? "text-fg-muted" : contentError ? "text-destructive" : "text-success"}`}
                >
                  {validation}
                </p>
                {formError && <Alert variant="destructive">{formError}</Alert>}
                <Button
                  type="submit"
                  disabled={!canCreate || isCreating}
                  className="w-full max-md:h-12"
                >
                  {isCreating ? "Creating…" : "Create prompt"}
                </Button>
                {!canCreate && (
                  <p className="text-caption text-fg-muted">
                    {!name.trim()
                      ? "Enter a prompt name."
                      : systemError || contentError}
                  </p>
                )}
              </fieldset>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageFrame>
  )
}
