/**
 * Page contract: AppShell owns the sole main landmark, page gutters, and top bars.
 * Wrap each route's content in PageFrame; supply breadcrumbs (label/to/title),
 * desktop actions, mobileTitle (section name), mobileBack (label/to), and optional
 * mobileAction. Do not render another top bar or main. PageFrame registers chrome
 * for the current location and renders a gap container plus the mobile back link.
 * PageHeader accepts title, description, metadata, and an optional title accessory.
 * List-page mobile New links target /prompts#create-prompt and
 * /datasets#create-dataset; those pages must place those IDs on their create forms.
 */
import { ChevronLeft } from "lucide-react"
import { useContext, useLayoutEffect, type ReactNode } from "react"
import { Link, useLocation } from "react-router-dom"

import { PageChromeContext, type PageChrome } from "./page-context"

export function PageFrame({ children, breadcrumbs, actions, mobileTitle, mobileBack, mobileAction }: PageChrome & { children: ReactNode }) {
  const register = useContext(PageChromeContext)
  const { key } = useLocation()
  useLayoutEffect(() => register?.(key, { breadcrumbs, actions, mobileTitle, mobileBack, mobileAction }),
    [register, key, breadcrumbs, actions, mobileTitle, mobileBack, mobileAction])
  return (
    <div className="flex min-w-0 flex-col gap-4 md:gap-5">
      {mobileBack && <Link to={mobileBack.to} className="flex min-h-11 items-center gap-1 font-mono text-data text-fg-secondary md:hidden"><ChevronLeft className="size-3.5" aria-hidden="true" />{mobileBack.label}</Link>}
      {children}
    </div>
  )
}
