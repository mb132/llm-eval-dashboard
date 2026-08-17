import type * as React from "react"

import { cn } from "@/lib/utils"

function Button({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="button"
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Button }
