import { cloneElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react"

import { cn } from "@/lib/utils"

type FieldControlProps = {
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: ComponentProps<"input">["aria-invalid"]
}

type FieldProps = Omit<ComponentProps<"div">, "children"> & {
  label: ReactNode
  htmlFor?: string
  optional?: boolean
  hint?: ReactNode
  error?: ReactNode
  children: ReactElement<FieldControlProps>
}

function Field({ label, htmlFor, optional, hint, error, children, className, ...props }: FieldProps) {
  const generatedId = useId()
  const controlId = htmlFor ?? children.props.id ?? generatedId
  const hasError = error !== undefined && error !== null && error !== false && error !== ""
  const message = hasError ? error : hint
  const hasMessage = message !== undefined && message !== null && message !== false && message !== ""
  const messageId = `${controlId}-${hasError ? "error" : "hint"}`
  const describedBy = [children.props["aria-describedby"], hasMessage ? messageId : undefined].filter(Boolean).join(" ") || undefined

  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5", className)} {...props}>
      <label htmlFor={controlId} className="flex items-center justify-between gap-3 text-caption font-medium">
        <span>{label}</span>
        {optional && <span className="font-normal text-fg-muted">Optional</span>}
      </label>
      {cloneElement(children, {
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": hasError ? true : children.props["aria-invalid"],
      })}
      {hasMessage && <div id={messageId} role={hasError ? "alert" : undefined} className={cn("text-caption", hasError ? "text-destructive" : "text-fg-muted")}>{message}</div>}
    </div>
  )
}

export { Field, type FieldProps }
