import type * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

type SelectProps = React.ComponentProps<"select"> & { wrapperClassName?: string }

function Select({ className, wrapperClassName, multiple, size, ...props }: SelectProps) {
  // Sizing and margins belong to the outer box now that the control has an icon.
  // Keep the remaining classes and every native prop on the select itself.
  const classes = className?.split(/\s+/) ?? []
  const isLayoutClass = (value: string) => /^(?:(?:sm|md|lg|xl|2xl):)*-?(?:(?:min-|max-)?w-|m[trblxyse]?-)/.test(value)
  const layoutClasses = classes.filter(isLayoutClass).join(" ")
  const controlClasses = classes.filter((value) => !isLayoutClass(value)).join(" ")
  const listbox = multiple || (size !== undefined && size > 1)
  return (
    <div data-slot="select-wrapper" className={cn("relative min-w-0 w-full", layoutClasses, wrapperClassName)}>
      <select
        data-slot="select"
        className={cn(
          "flex h-9 w-full rounded-md border border-line-strong bg-control px-3 py-2 text-body text-fg aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 max-md:text-[14px]",
          !listbox && "appearance-none pr-8 max-md:h-11",
          controlClasses,
        )}
        multiple={multiple}
        size={size}
        {...props}
      />
      {!listbox && <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted" />}
    </div>
  )
}

export { Select }
