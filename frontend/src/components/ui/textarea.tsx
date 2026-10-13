import type * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full resize-y rounded-md border border-line-strong bg-inset px-3 py-2 text-body text-fg placeholder:text-fg-muted aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 max-md:text-[14px]",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
