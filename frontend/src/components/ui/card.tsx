import { cloneElement, isValidElement, type ComponentProps } from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-line bg-panel text-fg",
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3", className)}
      {...props}
    />
  )
}

type CardTitleProps = ComponentProps<"div"> & {
  level?: 1 | 2 | 3 | 4 | 5 | 6
  asChild?: boolean
}

function CardTitle({ className, children, level = 2, asChild = false, ...props }: CardTitleProps) {
  const titleClassName = cn("text-section", className)
  if (asChild && isValidElement<ComponentProps<"div">>(children)) {
    return cloneElement(children, {
      ...props,
      "data-slot": "card-title",
      className: cn(titleClassName, children.props.className),
    } as ComponentProps<"div">)
  }

  // Older callers already provide their own heading; avoid nesting headings.
  const hasHeading = isValidElement(children) && typeof children.type === "string" && /^h[1-6]$/.test(children.type)
  const headings = ["h1", "h2", "h3", "h4", "h5", "h6"] as const
  const Title = hasHeading ? "div" : headings[level - 1]
  return (
    <Title
      data-slot="card-title"
      className={titleClassName}
      {...props}
    >{children}</Title>
  )
}

function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-caption text-fg-muted", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("p-4", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("border-t border-line px-4 py-2.5 text-caption text-fg-muted", className)} {...props} />
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
