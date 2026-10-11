import { useId, useRef, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SegmentOption = { value: string; label: ReactNode; count?: ReactNode; disabled?: boolean; id?: string; panelId?: string }
type SegmentedControlProps = {
  mode?: "tabs" | "radio"
  label: string
  options: SegmentOption[]
  value: string
  onValueChange: (value: string) => void
  name?: string
  id?: string
  className?: string
}
function SegmentedControl({ mode = "tabs", label, options, value, onValueChange, name, id, className }: SegmentedControlProps) {
  const generated = useId()
  const baseId = id ?? generated
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.findIndex((option) => option.value === value && !option.disabled)
  const tabStop = selected >= 0 ? selected : options.findIndex((option) => !option.disabled)
  const track = cn("inline-flex min-w-0 gap-0.5 rounded-md border border-line-strong bg-control p-0.5 max-md:grid max-md:w-full max-md:auto-cols-fr max-md:grid-flow-col", className)
  const itemClass = (option: SegmentOption) => cn("relative flex h-[26px] min-w-0 items-center justify-center gap-1.5 rounded-sm px-2.5 text-caption font-medium text-fg-secondary whitespace-normal [overflow-wrap:anywhere] max-md:h-10", option.value === value && "bg-hover text-fg", option.disabled && "cursor-not-allowed opacity-50")
  const content = (option: SegmentOption) => <>{option.label}{option.count != null && <> <span className="font-mono text-data-sm text-fg-muted">{option.count}</span></>}</>
  if (mode === "radio") return <fieldset className="min-w-0 border-0 p-0">
    <legend className="mb-1.5 text-caption font-medium">{label}</legend>
    <div className={track}>{options.map((option) => <label key={option.value} className={cn(itemClass(option), "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2", !option.disabled && "cursor-pointer hover:bg-hover")}>
      <input className="sr-only" type="radio" name={name ?? baseId} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onValueChange(option.value)} />{content(option)}
    </label>)}</div>
  </fieldset>
  return <div role="tablist" aria-label={label} className={track}>{options.map((option, index) => <Button
    key={option.value} ref={(element) => { refs.current[index] = element }} type="button" variant="ghost" size="xs"
    role="tab" id={option.id ?? `${baseId}-${option.value}-tab`} aria-controls={option.panelId ?? `${baseId}-${option.value}-panel`}
    aria-selected={value === option.value} tabIndex={index === tabStop ? 0 : -1} disabled={option.disabled} className={itemClass(option)}
    onClick={() => onValueChange(option.value)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      const enabled = options.map((item, i) => item.disabled ? -1 : i).filter((i) => i >= 0)
      const position = enabled.indexOf(index)
      const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1) : enabled[(position + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + enabled.length) % enabled.length]
      if (next !== undefined) { refs.current[next]?.focus(); onValueChange(options[next].value) }
    }}
  >{content(option)}</Button>)}</div>
}
export { SegmentedControl, type SegmentedControlProps, type SegmentOption }
