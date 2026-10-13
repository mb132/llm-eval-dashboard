import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react"
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react"
import type {
  MetadataValue,
  SecurityTestType,
  TestCaseMetadata,
  TestCasePayload,
  TestCaseType,
} from "@/api/datasets"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Select } from "@/components/ui/select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Textarea } from "@/components/ui/textarea"

type MetadataKind = "text" | "number" | "boolean" | "null"
type MetadataRow = { id: number; key: string; kind: MetadataKind; value: string }
let nextMetadataRowId = 0

function metadataRows(metadata: TestCaseMetadata | null | undefined): MetadataRow[] {
  return Object.entries(metadata ?? {}).map(([key, value]) => ({
    id: nextMetadataRowId++,
    key,
    ...displayMetadataValue(value),
  }))
}

function displayMetadataValue(value: MetadataValue): Pick<MetadataRow, "kind" | "value"> {
  if (value === null) return { kind: "null", value: "" }
  if (typeof value === "boolean") return { kind: "boolean", value: String(value) }
  if (typeof value === "number") return { kind: "number", value: String(value) }
  return { kind: "text", value }
}

export function TestCaseForm({
  initial,
  submitLabel,
  busy,
  disabled = false,
  error,
  onSubmit,
  onCancel,
  formId,
  disabledReason,
  onDirtyChange,
  editor = false,
  beforeFields,
  fieldsLegend = "Test case fields",
}: {
  initial?: TestCasePayload
  submitLabel: string
  busy: boolean
  disabled?: boolean
  error: string | null
  onSubmit: (payload: TestCasePayload) => Promise<void>
  onCancel?: () => void
  formId?: string
  disabledReason?: string
  onDirtyChange?: (dirty: boolean) => void
  editor?: boolean
  beforeFields?: ReactNode
  fieldsLegend?: string
}) {
  const fieldIdPrefix = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [input, setInput] = useState(initial?.input ?? "")
  const [expectedAnswer, setExpectedAnswer] = useState(initial?.expected_answer ?? "")
  const [caseType, setCaseType] = useState<TestCaseType>(
    initial?.case_type ?? "standard",
  )
  const [securityTestType, setSecurityTestType] = useState<SecurityTestType>(
    initial?.security_test_type ?? "direct_prompt_injection",
  )
  const [category, setCategory] = useState(initial?.category ?? "")
  const [metadata, setMetadata] = useState(() => metadataRows(initial?.metadata))
  const parsedMetadata = parseMetadata(metadata)
  const requiredError = !input.trim() || !expectedAnswer.trim()
    ? `Input and ${caseType === "security" ? "failure marker" : "expected answer"} are required.`
    : null
  const validationError = typeof parsedMetadata === "string" ? parsedMetadata : null
  const requiredMessageId = `${fieldIdPrefix}-required`
  const metadataMessageId = `${fieldIdPrefix}-metadata-error`
  const metadataKeys = metadata.map((row) => row.key.trim())
  const draft = JSON.stringify([input, expectedAnswer, caseType, securityTestType, category, metadata.map(({ key, kind, value }) => ({ key, kind, value }))])
  const [originalDraft] = useState(draft)
  useEffect(() => { onDirtyChange?.(draft !== originalDraft) }, [draft, originalDraft, onDirtyChange])
  useEffect(() => { if (editor) inputRef.current?.focus() }, [editor])
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || disabled || requiredError || validationError || typeof parsedMetadata === "string") return
    await onSubmit({
      input,
      expected_answer: expectedAnswer,
      case_type: caseType,
      security_test_type: caseType === "security" ? securityTestType : null,
      category: category.trim() || null,
      metadata: parsedMetadata,
    })
  }
  function updateRow(id: number, update: Partial<MetadataRow>) {
    setMetadata((rows) => rows.map((row) => (row.id === id ? { ...row, ...update } : row)))
  }
  return (
    <form id={formId} className="space-y-4" onSubmit={handleSubmit} noValidate>
      {beforeFields}
      <fieldset
        disabled={busy}
        className={editor ? "grid min-w-0 gap-4 md:grid-cols-2" : "min-w-0 space-y-4"}
      >
        <legend
          className={fieldsLegend === "Test case fields" ? "sr-only" : "mb-4 text-overline text-fg-muted"}
        >{fieldsLegend}
        </legend>
        <Field label="Input" htmlFor={`${fieldIdPrefix}-input`}>
          <Textarea
            id={`${fieldIdPrefix}-input`}
            ref={inputRef}
            aria-describedby={requiredError ? requiredMessageId : undefined}
            className="font-mono [overflow-wrap:anywhere]"
            rows={editor ? 9 : 4}
            value={input}
            maxLength={20_000}
            onChange={(event) => setInput(event.target.value)}
            placeholder="What is the capital of France?"
            required
          />
        </Field>
        <div className="min-w-0 space-y-4">
          <SegmentedControl
            mode="radio"
            label="Test case type"
            value={caseType}
            className="[&_label]:h-10"
            options={[{ value: "standard", label: "Standard" }, { value: "security", label: "Security" }]}
            onValueChange={(value) => setCaseType(value as TestCaseType)}
          />
          {caseType === "security" && (
            <Field
              label="Security test type"
              htmlFor={`${fieldIdPrefix}-security-test-type`}
            >
              <Select
                id={`${fieldIdPrefix}-security-test-type`}
                value={securityTestType}
                onChange={(event) =>
                  setSecurityTestType(event.target.value as SecurityTestType)
                }
              >
                <option value="direct_prompt_injection">Direct prompt injection</option>
                <option value="instruction_override">Instruction override</option>
                <option value="system_prompt_extraction">System prompt extraction</option>
              </Select>
            </Field>
          )}
          <Field
            label={caseType === "security" ? "Failure marker" : "Expected answer"}
            htmlFor={`${fieldIdPrefix}-expected-answer`}
            hint={caseType === "security" ? "The test fails if the reply contains this text." : undefined}
          >
            <Textarea
              id={`${fieldIdPrefix}-expected-answer`}
              className={caseType === "security" ? "min-h-9 h-9 resize-y font-mono max-md:min-h-11 max-md:h-11" : "font-mono"}
              rows={caseType === "security" ? 1 : undefined}
              aria-describedby={requiredError ? requiredMessageId : undefined}
              value={expectedAnswer}
              maxLength={20_000}
              onChange={(event) => setExpectedAnswer(event.target.value)}
              placeholder={caseType === "security" ? "SECURITY_TEST_FAILED" : "Paris"}
              required
            />
          </Field>
          <Field label="Category" htmlFor={`${fieldIdPrefix}-category`} optional>
            <Input
              id={`${fieldIdPrefix}-category`}
              className="font-mono"
              value={category}
              maxLength={100}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="general-knowledge"
            />
          </Field>

          <fieldset className="space-y-3">
            <legend className="text-caption font-medium">Metadata · up to 20 flat key/value pairs</legend>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Up to 20 flat key/value pairs. Nested objects and lists are not
                supported.
              </p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="shrink-0 whitespace-nowrap max-md:min-h-11 max-md:text-sm"
                disabled={metadata.length >= 20}
                onClick={() =>
                  setMetadata((rows) => [
                    ...rows,
                    { id: nextMetadataRowId++, key: "", kind: "text", value: "" },
                  ])
                }
              >
                <Plus className="size-4" />
                Add field
              </Button>
            </div>
            {metadata.length >= 20 && <p className="text-caption text-fg-muted">Metadata has reached the limit of 20 fields.</p>}
            {metadata.map((row, index) => (
              <div
                key={row.id}
                className="grid min-w-0 grid-cols-2 gap-2 rounded-md border border-line bg-inset p-2"
              >
                <Field label="Key" htmlFor={`${fieldIdPrefix}-metadata-key-${row.id}`}>
                  <Input
                    className="font-mono"
                    aria-label={`Metadata key ${index + 1}`}
                    aria-invalid={!row.key.trim() || metadataKeys.filter((key) => key === row.key.trim()).length > 1}
                    aria-describedby={validationError ? metadataMessageId : undefined}
                    value={row.key}
                    maxLength={100}
                    placeholder="difficulty"
                    onChange={(event) => updateRow(row.id, { key: event.target.value })}
                  />
                </Field>
                <Field label="Type" htmlFor={`${fieldIdPrefix}-metadata-type-${row.id}`}>
                  <Select
                    className="font-mono"
                    aria-label={`Metadata type ${index + 1}`}
                    value={row.kind}
                    onChange={(event) =>
                      updateRow(row.id, {
                        kind: event.target.value as MetadataKind,
                        value: "",
                      })
                    }
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="null">Null</option>
                  </Select>
                </Field>
                <Field label="Value" htmlFor={`${fieldIdPrefix}-metadata-value-${row.id}`}>
                  {row.kind === "boolean" ? (
                    <Select
                      className="font-mono"
                      aria-label={`Metadata value ${index + 1}`}
                      aria-describedby={validationError ? metadataMessageId : undefined}
                      value={row.value || "true"}
                      onChange={(event) => updateRow(row.id, { value: event.target.value })}
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </Select>
                  ) : (
                    <Input
                      className="font-mono"
                      aria-label={`Metadata value ${index + 1}`}
                      aria-invalid={row.kind === "number" && (!row.value.trim() || !Number.isFinite(Number(row.value)))}
                      aria-describedby={validationError ? metadataMessageId : undefined}
                      value={row.value}
                      maxLength={row.kind === "text" ? 1_000 : undefined}
                      type="text"
                      inputMode={row.kind === "number" ? "decimal" : undefined}
                      disabled={row.kind === "null"}
                      placeholder={row.kind === "null" ? "null" : "easy"}
                      onChange={(event) => updateRow(row.id, { value: event.target.value })}
                    />
                  )}
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  className="self-end"
                  aria-label={`Remove metadata field ${index + 1}`}
                  onClick={() =>
                    setMetadata((rows) =>
                      rows.filter((item) => item.id !== row.id),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </fieldset>
        </div>
      </fieldset>
      {disabledReason && <p
        id={`${formId ?? fieldIdPrefix}-disabled-reason`}
        className="text-caption text-fg-muted"
        role="status"
      >{disabledReason}
      </p>}
      {requiredError && <p id={requiredMessageId} className="text-caption text-fg-muted" role="status">{requiredError}
      </p>}
      {validationError && (
        <Alert id={metadataMessageId} variant="destructive" role="alert">
          {validationError}
        </Alert>
      )}
      {error && <Alert variant="destructive" role="alert">{error}
      </Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          className="max-md:min-h-12"
          disabled={busy || disabled || !!requiredError || !!validationError}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {busy ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className="max-md:min-h-11"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function parseMetadata(rows: MetadataRow[]): TestCaseMetadata | null | string {
  if (rows.length === 0) return null
  const entries: [string, MetadataValue][] = []
  const keys = new Set<string>()
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) return "Every metadata field needs a key."
    if (keys.has(key)) return "Metadata keys must be unique."
    keys.add(key)
    if (row.kind === "number") {
      if (!row.value.trim() || !Number.isFinite(Number(row.value))) {
        return `Metadata value “${key}” must be a finite number.`
      }
      entries.push([key, Number(row.value)])
    } else if (row.kind === "boolean") {
      entries.push([key, (row.value || "true") === "true"])
    } else if (row.kind === "null") {
      entries.push([key, null])
    } else {
      entries.push([key, row.value])
    }
  }
  return Object.fromEntries(entries)
}
