import { Fragment } from "react"
import { Link } from "react-router-dom"

import type { BreadcrumbItem } from "./page-context"

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 font-mono text-data text-fg-muted">
      {items.map((item, index) => <Fragment key={`${index}-${item.label}`}>
        {index > 0 && <span aria-hidden="true">/</span>}
        {item.to && index < items.length - 1
          ? <Link to={item.to} title={item.title} className="truncate text-fg-secondary hover:underline">{item.label}</Link>
          : <span title={item.title} aria-current="page" className="truncate text-fg">{item.label}</span>}
      </Fragment>)}
    </nav>
  )
}
