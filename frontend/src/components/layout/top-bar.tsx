import { Breadcrumb } from "./breadcrumb"
import type { PageChrome } from "./page-context"

export function TopBar({ breadcrumbs, actions }: PageChrome) {
  return <header className="hidden min-h-[52px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-chrome px-6 py-2.5 md:flex">
    <Breadcrumb items={breadcrumbs} />
    <div className="ml-auto flex min-w-0 items-center gap-2">{actions}</div>
  </header>
}
