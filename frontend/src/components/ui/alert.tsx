import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "@/lib/utils"

const alertVariants = cva("rounded-md px-3 py-2.5 text-body flex gap-2 items-start [&>svg]:size-4 [&>svg]:shrink-0", {
  variants: {
    variant: {
      default: "border border-line bg-inset text-fg",
      destructive: "bg-destructive-soft text-destructive [&_p]:text-fg",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      info: "bg-info-soft text-info",
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
      role={variant === "destructive" ? "alert" : variant === "success" ? "status" : undefined}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Alert, alertVariants }
