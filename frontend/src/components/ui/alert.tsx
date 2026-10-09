import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "@/lib/utils"

const alertVariants = cva("rounded-lg border p-3 text-sm", {
  variants: {
    variant: {
      default: "bg-card text-card-foreground",
      destructive: "border-destructive-border bg-destructive-soft text-destructive-soft-foreground",
      success: "border-success-border bg-success-soft text-success-soft-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Alert, alertVariants }
