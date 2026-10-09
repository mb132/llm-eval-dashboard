import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react"
import { useId, useState, type FormEvent } from "react"

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
import { Select } from "@/components/ui/select"
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
}: {
  initial?: TestCasePayload
  submitLabel: string
  busy: boolean
  disabled?: boolean
  error: string | null
  onSubmit: (payload: TestCasePayload) => Promise<void>
  onCancel?: () => void
  formId?: string
}) {
  const fieldIdPrefix = useId()
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
  const [validationError, setValidationError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!input.trim() || !expectedAnswer.trim()) {
      setValidationError("Input and expected answer are required.")
      return
    }
    const parsedMetadata = parseMetadata(metadata)
    if (typeof parsedMetadata === "string") {
      setValidationError(parsedMetadata)
      return
    }
    setValidationError(null)
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
    <form id={formId} className="space-y-5" onSubmit={handleSubmit} noValidate>
      <Field label="Input" htmlFor={`${fieldIdPrefix}-input`}>
        <Textarea
          id={`${fieldIdPrefix}-input`}
          value={input}
          maxLength={20_000}
          onChange={(event) => setInput(event.target.value)}
          placeholder="What is the capital of France?"
          required
        />
      </Field>
      <Field label="Test case type" htmlFor={`${fieldIdPrefix}-case-type`}>
        <Select
          id={`${fieldIdPrefix}-case-type`}
          value={caseType}
          onChange={(event) => setCaseType(event.target.value as TestCaseType)}
        >
          <option value="standard">Standard</option>
          <option value="security">Security</option>
        </Select>
      </Field>
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
      >
        <Textarea
          id={`${fieldIdPrefix}-expected-answer`}
          value={expectedAnswer}
          maxLength={20_000}
          onChange={(event) => setExpectedAnswer(event.target.value)}
          placeholder={caseType === "security" ? "SECURITY_TEST_FAILED" : "Paris"}
          required
        />
        {caseType === "security" && (
          <p className="text-xs text-muted-foreground">
            The test fails if the normalized model response contains this
            synthetic marker.
          </p>
        )}
      </Field>
      <Field label="Category" htmlFor={`${fieldIdPrefix}-category`} optional>
        <Input
          id={`${fieldIdPrefix}-category`}
          value={category}
          maxLength={100}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="general-knowledge"
        />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Metadata (optional)</legend>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Up to 20 flat key/value pairs. Nested objects and lists are not
            supported.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 whitespace-nowrap"
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
        {metadata.map((row, index) => (
          <div
            key={row.id}
            className="grid gap-2 rounded-lg border bg-muted/40 p-3 sm:grid-cols-[1fr_8rem_1fr_auto]"
          >
            <Input
              aria-label={`Metadata key ${index + 1}`}
              value={row.key}
              maxLength={100}
              placeholder="difficulty"
              onChange={(event) => updateRow(row.id, { key: event.target.value })}
            />
            <Select
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
            {row.kind === "boolean" ? (
              <Select
                aria-label={`Metadata value ${index + 1}`}
                value={row.value || "true"}
                onChange={(event) => updateRow(row.id, { value: event.target.value })}
              >
                <option value="true">True</option>
                <option value="false">False</option>
              </Select>
            ) : (
              <Input
                aria-label={`Metadata value ${index + 1}`}
                value={row.value}
                maxLength={row.kind === "text" ? 1_000 : undefined}
                type={row.kind === "number" ? "number" : "text"}
                disabled={row.kind === "null"}
                placeholder={row.kind === "null" ? "null" : "easy"}
                onChange={(event) => updateRow(row.id, { value: event.target.value })}
              />
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10"
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

      {(validationError || error) && (
        <Alert variant="destructive" role="alert">
          {validationError ?? error}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || disabled}>
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
