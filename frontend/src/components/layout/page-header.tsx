import type { ReactNode } from "react"

export function PageHeader({ title, description, metadata, accessory }: {
  title: ReactNode
  description?: ReactNode
  metadata?: ReactNode
  accessory?: ReactNode
}) {
  return (
    <header className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="min-w-0 text-title [overflow-wrap:anywhere]">{title}</h1>
        {accessory}
      </div>
      {description && <div className="text-caption text-fg-muted">{description}</div>}
      {metadata && <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-caption text-fg-muted">{metadata}</div>}
    </header>
  )
}
