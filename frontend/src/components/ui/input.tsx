import type * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-line-strong bg-inset px-3 py-2 text-body text-fg placeholder:text-fg-muted aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 max-md:h-11 max-md:text-[14px]",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
