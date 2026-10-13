import { createContext, type ReactNode } from "react"

export type BreadcrumbItem = { label: string; to?: string; title?: string }
export type PageChrome = {
  breadcrumbs: BreadcrumbItem[]
  actions?: ReactNode
  mobileTitle?: string
  mobileBack?: { label: string; to: string }
  mobileAction?: ReactNode
}

export const PageChromeContext = createContext<((key: string, chrome: PageChrome) => () => void) | null>(null)
