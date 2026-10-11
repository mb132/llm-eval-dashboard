import { readFileSync } from "node:fs"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let ThemeToggle: typeof import("@/components/ui/theme-toggle").ThemeToggle
let media: MediaQueryList
let systemChange: () => void

beforeEach(async () => {
  vi.resetModules()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  systemChange = () => {}
  media = {
    matches: false,
    media: "(prefers-color-scheme: light)",
    addEventListener: vi.fn((_event, listener) => { systemChange = listener }),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList
  vi.stubGlobal("matchMedia", vi.fn(() => media))
  ;({ ThemeToggle } = await import("@/components/ui/theme-toggle"))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function changeSystem(light: boolean) {
  Object.defineProperty(media, "matches", { value: light, configurable: true })
  act(() => systemChange())
}

function storageChange(newValue: string | null, key: string | null = "llm-eval-theme") {
  act(() => window.dispatchEvent(new StorageEvent("storage", { key, newValue })))
}

describe("theme controls", () => {
  it("uses the initial document theme and persists a desktop selection", () => {
    document.documentElement.dataset.theme = "dark"
    render(<ThemeToggle />)
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Light" }))
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    expect(window.localStorage.getItem("llm-eval-theme")).toBe("light")
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false")
  })

  it("honors a saved choice over the system preference", () => {
    window.localStorage.setItem("llm-eval-theme", "light")
    render(<ThemeToggle />)
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true")
    changeSystem(false)
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
  })

  it("follows system changes until a user selects a theme", () => {
    render(<ThemeToggle />)
    changeSystem(true)
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    expect(window.localStorage.getItem("llm-eval-theme")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Light" }))
    changeSystem(false)
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
  })

  it("synchronizes desktop and mobile controls in the same document", () => {
    render(<><ThemeToggle /><ThemeToggle variant="mobile" /></>)
    const mobile = screen.getByRole("button", { name: "Switch to light theme" })
    expect(mobile).toHaveClass("size-11")
    expect(mobile.querySelector("svg")).toHaveClass("lucide-sun")
    fireEvent.click(mobile)
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Switch to dark theme" }).querySelector("svg")).toHaveClass("lucide-moon")
    fireEvent.click(screen.getByRole("button", { name: "Dark" }))
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument()
    expect(window.localStorage.getItem("llm-eval-theme")).toBe("dark")
  })

  it("accepts cross-tab changes and resumes system preference when storage is cleared", () => {
    render(<><ThemeToggle /><ThemeToggle variant="mobile" /></>)
    storageChange("light")
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument()
    changeSystem(false)
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    storageChange(null)
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    changeSystem(true)
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    storageChange("dark")
    storageChange(null, null)
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
  })

  it("ignores unrelated and session-storage events", () => {
    render(<ThemeToggle />)
    storageChange("light", "other-key")
    act(() => window.dispatchEvent(new StorageEvent("storage", {
      key: "llm-eval-theme", newValue: "light", storageArea: window.sessionStorage,
    })))
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
  })

  it("treats invalid stored preferences as system preference", () => {
    window.localStorage.setItem("llm-eval-theme", "invalid")
    Object.defineProperty(media, "matches", { value: true, configurable: true })
    render(<ThemeToggle />)
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    changeSystem(false)
    storageChange("invalid")
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
  })

  it("keeps controls synchronized and the chosen theme when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    const view = render(<><ThemeToggle /><ThemeToggle variant="mobile" /></>)
    changeSystem(true)
    fireEvent.click(screen.getByRole("button", { name: "Dark" }))
    changeSystem(true)
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument()
    view.unmount()
    render(<ThemeToggle />)
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true")
  })

  it("cleans up listeners when the last control unmounts", () => {
    const remove = vi.spyOn(window, "removeEventListener")
    const view = render(<ThemeToggle />)
    view.unmount()
    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function))
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function))
  })
})

describe("initial theme script", () => {
  const html = readFileSync("index.html", "utf8")
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]

  it("runs in the head before the module or styles are loaded", () => {
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("</head>"))
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('type="module"'))
    expect(html.slice(0, html.indexOf("<script>"))).not.toMatch(/<style|stylesheet/)
  })

  it.each(["dark", "light"])("applies saved %s before rendering", (theme) => {
    window.localStorage.setItem("llm-eval-theme", theme)
    window.eval(script)
    expect(document.documentElement).toHaveAttribute("data-theme", theme)
  })

  it("uses the OS preference for missing or invalid storage", () => {
    Object.defineProperty(media, "matches", { value: true, configurable: true })
    window.eval(script)
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    window.localStorage.setItem("llm-eval-theme", "invalid")
    changeSystem(false)
    window.eval(script)
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
  })

  it("uses the OS preference when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    Object.defineProperty(media, "matches", { value: true, configurable: true })
    window.eval(script)
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
  })
})
