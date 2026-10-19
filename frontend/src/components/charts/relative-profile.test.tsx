import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ComparisonChart, type ComparisonChartRow } from "./relative-profile"

afterEach(cleanup)

const row = (id: string, values: Partial<ComparisonChartRow> = {}): ComparisonChartRow => ({
  id, name: id, quality: 0.5, latency: 100, tokens: 200, cost: 0.01, security: 0.8, ...values,
})

function point(container: HTMLElement, id: string, axis: string) {
  return container.querySelector(`[data-series="${id}"] circle[data-axis="${axis}"]`)!
}

describe("ComparisonChart", () => {
  it("normalizes all five axes to the best, using ratios instead of min/max ranges", () => {
    const { container } = render(<ComparisonChart rows={[row("A"), row("B", { quality: 0.25, latency: 200, tokens: 400, cost: 0.02, security: 0.4 })]} />)
    for (const axis of ["quality", "latency", "tokens", "cost", "security"]) {
      expect(point(container, "A", axis)).toHaveAttribute("cy", "30")
      expect(point(container, "B", axis)).toHaveAttribute("cy", "100")
    }
    expect(screen.getByRole("img")).toHaveAccessibleName("Relative profile. Quality: A leads. Latency: A leads. Tokens: A leads. Est. cost: A leads. Security: A leads.")
  })

  it("breaks lines at missing axes and renders hollow bottom rings with reasons", () => {
    const { container } = render(<ComparisonChart rows={[row("A", { tokens: null }), row("B", { cost: null, security: null })]} />)
    const polylines = container.querySelector('[data-series="A"]')!.querySelectorAll("polyline")
    expect(Array.from(polylines, (line) => line.getAttribute("points"))).toEqual(["0,0 1,0", "3,0 4,0"])
    expect(point(container, "A", "tokens")).toHaveAttribute("cy", "170")
    expect(point(container, "A", "tokens")).toHaveClass("fill-panel")
    expect(point(container, "B", "cost")).toHaveTextContent("B · Est. cost: no price")
    expect(point(container, "B", "security")).toHaveTextContent("B · Security: no data")
  })

  it("keeps zero values finite: tied zeros at top, positive lower-better values at bottom", () => {
    const { container } = render(<ComparisonChart rows={[row("A", { quality: 0, latency: 0, tokens: 0, cost: 0, security: 0 }), row("B", { quality: 0, security: 0 })]} />)
    for (const axis of ["quality", "latency", "tokens", "cost", "security"]) expect(point(container, "A", axis)).toHaveAttribute("cy", "30")
    for (const axis of ["latency", "tokens", "cost"]) expect(point(container, "B", axis)).toHaveAttribute("cy", "170")
    expect(screen.getByRole("img")).toHaveAccessibleName(/Quality: A, B tie for best/)
    for (const circle of container.querySelectorAll("circle")) expect(Number.isFinite(Number(circle.getAttribute("cy")))).toBe(true)
    for (const line of container.querySelectorAll("polyline")) expect(line.getAttribute("points")).not.toMatch(/NaN|Infinity/)
    expect(within(screen.getByRole("table")).getAllByText("0.0%")).toHaveLength(4)
  })

  it("rejects invalid values, states missing leaders and dashes the absent security axis", () => {
    const { container } = render(<ComparisonChart rows={[row("A", { quality: Number.NaN, latency: Infinity, tokens: -1, cost: null, security: null })]} />)
    expect(screen.getByRole("img")).toHaveAccessibleName("Relative profile. Quality: no data. Latency: no data. Tokens: no data. Est. cost: no data. Security: no data.")
    expect(container.querySelectorAll('circle[data-missing="true"]')).toHaveLength(5)
    expect(container.querySelector('line[stroke-dasharray="2 4"]')).toHaveAttribute("x1", "90%")
    expect(container.querySelectorAll("polyline")).toHaveLength(0)
  })

  it("exposes exact formatted values and lets keyboard-operable legend buttons toggle highlighting", () => {
    const { container } = render(<ComparisonChart rows={[row("A", { latency: 9861, tokens: 101300, cost: 0.018609 }), row("B")]} />)
    const table = within(screen.getByRole("table", { name: "Relative profile exact values" }))
    expect(table.getByText("9,861 ms")).toBeInTheDocument()
    expect(table.getByText("101.3k")).toBeInTheDocument()
    expect(table.getByText("$0.018609")).toBeInTheDocument()
    const button = screen.getByRole("button", { name: "A" })
    fireEvent.click(button)
    expect(button).toHaveAttribute("aria-pressed", "true")
    expect(container.querySelector('[data-series="B"]')).toHaveAttribute("opacity", "0.18")
    fireEvent.click(button)
    expect(button).toHaveAttribute("aria-pressed", "false")
    expect(container.querySelector('[data-series="B"]')).toHaveAttribute("opacity", "1")
  })

  it("assigns ordered token colors and gives the fourth series a light-theme hollow marker", () => {
    const { container } = render(<ComparisonChart rows={[row("A"), row("B"), row("C"), row("D")]} />)
    for (const [index, id] of ["A", "B", "C", "D"].entries()) expect(container.querySelector(`[data-series="${id}"]`)).toHaveStyle({ color: `var(--le-series-${index + 1})` })
    expect(point(container, "D", "quality")).toHaveClass("[[data-theme=light]_&]:fill-panel")
    expect(screen.getByRole("button", { name: "D" }).querySelector("span")).toHaveClass("[[data-theme=light]_&]:bg-panel")
  })

  it("falls back to the complete legend and visible exact-value table for more than four series", () => {
    render(<ComparisonChart rows={Array.from({ length: 6 }, (_, index) => row(`Model ${index + 1}`, { tokens: index + 1 }))} />)
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText("More than four series: compare exact values in the table.")).toBeInTheDocument()
    expect(screen.getByRole("group")).toContainElement(screen.getByRole("button", { name: "Model 6" }))
    expect(screen.getByRole("button", { name: "Model 5" }).querySelector("span")).toHaveStyle({ backgroundColor: "var(--le-accent-muted)" })
    const table = screen.getByRole("table")
    expect(table.parentElement!.parentElement).not.toHaveClass("sr-only")
    expect(table).toHaveClass("min-w-[560px]")
    expect(table.parentElement).toHaveClass("overflow-x-auto")
    expect(within(table).getByRole("columnheader", { name: "Tokens" })).toHaveClass("text-right")
    expect(within(table).getAllByRole("row")).toHaveLength(7)
    expect(within(table).getByRole("row", { name: /Model 6/ })).toHaveTextContent("6")
  })

  it("uses fluid geometry while keeping readable axis text and hiding mobile value labels", () => {
    const { container } = render(<ComparisonChart rows={[row("A", { name: "Averylongunbrokenmodelname" })]} />)
    const svg = screen.getByRole("img")
    expect(svg).toHaveAttribute("width", "100%")
    expect(svg).not.toHaveAttribute("viewBox")
    expect(container.querySelector('[data-series] svg')).toHaveAttribute("preserveAspectRatio", "none")
    const axisNames = Array.from(svg.querySelectorAll("text")).filter((text) => text.getAttribute("y") === "200")
    expect(axisNames.map((text) => text.textContent)).toEqual(["Quality", "Latency", "Tokens", "Est. cost", "Security"])
    for (const text of axisNames) expect(text).toHaveClass("text-caption")
    for (const text of svg.querySelectorAll("[data-series] text")) expect(text).toHaveClass("hidden", "md:block")
    expect(screen.getByRole("button").lastChild).toHaveClass("[overflow-wrap:anywhere]")
  })

  it("handles empty input without an empty chart", () => {
    render(<ComparisonChart rows={[]} />)
    expect(screen.getByText("No comparison data.")).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("keeps top-edge value labels in bounds, desktop ticks, mobile missing hints and touch targets", () => {
    const { container } = render(<ComparisonChart rows={[row("A", { cost: null, security: null }), row("B", { security: null }), row("C", { security: null }), row("D", { security: null })]} />)
    const svg = screen.getByRole("img")
    for (const text of svg.querySelectorAll("[data-series] text")) {
      expect(Number(text.getAttribute("y"))).toBeGreaterThanOrEqual(14)
      expect(Number(text.getAttribute("y"))).toBeLessThanOrEqual(184)
    }
    expect(within(svg).getByText("50%").parentElement).toHaveClass("hidden", "md:block")
    expect(within(svg).getByText("0").parentElement).toHaveClass("hidden", "md:block")
    expect(within(svg).getByText("1 n/a")).toHaveClass("md:hidden")
    expect(Array.from(svg.querySelectorAll('text[y="218"]')).filter((text) => text.textContent === "no data")).toHaveLength(2)
    for (const button of container.querySelectorAll("button")) {
      expect(button).toHaveAttribute("type", "button")
      expect(button).toHaveClass("min-h-11")
    }
  })
})
