import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-body font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-primary bg-primary text-primary-foreground font-semibold hover:not-disabled:bg-primary/90",
        outline: "border border-line-strong bg-control text-fg hover:not-disabled:bg-hover",
        secondary: "border border-line-strong bg-control text-fg hover:not-disabled:bg-hover",
        ghost: "bg-transparent text-fg-secondary hover:not-disabled:bg-hover hover:not-disabled:text-fg",
        destructive: "border border-destructive bg-transparent text-destructive hover:not-disabled:bg-destructive-soft",
        link: "text-link underline-offset-4 hover:not-disabled:underline",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-3",
        xs: "h-7 px-2.5 text-caption",
        lg: "h-10 px-4",
        icon: "size-8 p-0",
        "icon-lg": "size-11 p-0 [&_svg]:size-[18px]",
        touch: "h-11 px-4 text-[14px]",
      },
    },
    compoundVariants: [{ variant: "link", className: "p-0" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
