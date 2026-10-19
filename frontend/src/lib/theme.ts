import { useSyncExternalStore } from "react"

export type Theme = "dark" | "light"

const storageKey = "llm-eval-theme"
const listeners = new Set<() => void>()
let initialized = false
let choice: Theme | null = null
let media: MediaQueryList | undefined

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light"
}

function systemTheme(): Theme {
  return media?.matches ? "light" : "dark"
}

function publish(theme: Theme) {
  document.documentElement.dataset.theme = theme
  listeners.forEach((listener) => listener())
}

function initialize() {
  if (initialized) return
  initialized = true
  media = window.matchMedia?.("(prefers-color-scheme: light)")
  try {
    const saved = window.localStorage.getItem(storageKey)
    choice = isTheme(saved) ? saved : null
  } catch {
    // Storage can be blocked; the system preference still works.
  }
  const initial = document.documentElement.dataset.theme
  document.documentElement.dataset.theme = choice ?? (isTheme(initial) ? initial : systemTheme())
}

function onSystemChange() {
  if (choice === null) publish(systemTheme())
}

function onStorage(event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return
  // Ignore sessionStorage events, which use the same event type.
  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return
  } catch {
    // A synthetic or cross-tab event can still carry a valid preference.
  }
  choice = isTheme(event.newValue) ? event.newValue : null
  publish(choice ?? systemTheme())
}

function subscribe(listener: () => void) {
  initialize()
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage)
    media?.addEventListener("change", onSystemChange)
    // The system may have changed while no controls were mounted.
    if (choice === null) publish(systemTheme())
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage)
      media?.removeEventListener("change", onSystemChange)
    }
  }
}

function getSnapshot(): Theme {
  const theme = document.documentElement.dataset.theme
  return isTheme(theme) ? theme : "dark"
}

function setTheme(theme: Theme) {
  initialize()
  choice = theme
  try {
    window.localStorage.setItem(storageKey, theme)
  } catch {
    // Keep the choice for this document even when persistence is unavailable.
  }
  publish(theme)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "dark" as const)
  return { theme, setTheme }
}
