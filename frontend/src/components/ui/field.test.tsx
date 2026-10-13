import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { Field } from "./field"
import { Input } from "./input"
import { Select } from "./select"
import { Switch } from "./switch"
import { CardTitle } from "./card"
import { Alert } from "./alert"
import { cn } from "@/lib/utils"

describe("shared semantic helpers", () => {
  it("toggles a labelled switch through its label and keyboard without submitting the form", async () => {
    const user = userEvent.setup()
    const submit = vi.fn((event) => event.preventDefault())
    function LabelledSwitch() {
      const [checked, setChecked] = useState(false)
      return <form onSubmit={submit}>
        <Switch id="active-model" checked={checked} onCheckedChange={setChecked} />
        <label htmlFor="active-model">Active model</label>
      </form>
    }
    render(<LabelledSwitch />)
    const control = screen.getByRole("switch", { name: "Active model" })
    expect(control).toHaveAttribute("aria-checked", "false")
    await user.click(screen.getByText("Active model"))
    expect(control).toHaveAttribute("aria-checked", "true")
    control.focus()
    await user.keyboard(" ")
    expect(control).toHaveAttribute("aria-checked", "false")
    await user.keyboard("{Enter}")
    expect(control).toHaveAttribute("aria-checked", "true")
    expect(submit).not.toHaveBeenCalled()
  })

  it("prevents labelled switch activation when disabled directly or by a fieldset", async () => {
    const user = userEvent.setup()
    const change = vi.fn()
    const { rerender } = render(<>
      <Switch id="active-model" checked onCheckedChange={change} disabled />
      <label htmlFor="active-model">Active model</label>
    </>)
    const control = screen.getByRole("switch", { name: "Active model" })
    await user.click(screen.getByText("Active model"))
    await user.click(control)
    expect(control).toBeDisabled()
    expect(control).toHaveAttribute("aria-checked", "true")
    expect(change).not.toHaveBeenCalled()
    rerender(<fieldset disabled>
      <Switch id="active-model" checked onCheckedChange={change} />
      <label htmlFor="active-model">Active model</label>
    </fieldset>)
    await user.click(screen.getByText("Active model"))
    await user.click(screen.getByRole("switch"))
    expect(screen.getByRole("switch")).toBeDisabled()
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true")
    expect(change).not.toHaveBeenCalled()
  })

  it("generates distinct IDs and associates labels with controls", () => {
    render(<><Field label="Name"><Input /></Field><Field label="Description" optional><Input /></Field></>)
    const name = screen.getByRole("textbox", { name: "Name" })
    const description = screen.getByRole("textbox", { name: "Description Optional" })
    expect(name.id).not.toBe("")
    expect(description.id).not.toBe(name.id)
    expect(screen.getByText("Name").closest("label")).toHaveAttribute("for", name.id)
  })
  it("respects IDs, preserves descriptions and prioritizes errors over hints", () => {
    const { rerender } = render(<><p id="external">External help</p><Field label="Name" htmlFor="explicit" hint="Helpful hint"><Input id="child" aria-describedby="external" /></Field></>)
    expect(screen.getByRole("textbox")).toHaveAttribute("id", "explicit")
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("External help Helpful hint")
    rerender(<><p id="external">External help</p><Field label="Name" error="Name is required" hint="Helpful hint"><Input id="child" aria-describedby="external" /></Field></>)
    expect(screen.getByRole("textbox")).toHaveAttribute("id", "child")
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("External help Name is required")
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required")
    expect(screen.queryByText("Helpful hint")).not.toBeInTheDocument()
  })
  it("preserves caller invalid state and omits empty hint linkage", () => {
    render(<Field label="Name" error="" hint=""><Input aria-invalid="grammar" /></Field>)
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "grammar")
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-describedby")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
  it("renders plain panel titles as h2 and supports existing headings and levels", () => {
    render(<><CardTitle>Models</CardTitle><CardTitle><h3>Existing title</h3></CardTitle><CardTitle level={4}>Nested section</CardTitle><CardTitle asChild id="adopted"><h5>Adopted heading</h5></CardTitle></>)
    expect(screen.getByRole("heading", { level: 2, name: "Models" })).toBeVisible()
    expect(screen.getByRole("heading", { level: 3, name: "Existing title" }).parentElement?.tagName).toBe("DIV")
    expect(screen.getByRole("heading", { level: 4, name: "Nested section" })).toBeVisible()
    expect(screen.getByRole("heading", { level: 5, name: "Adopted heading" })).toHaveAttribute("id", "adopted")
    expect(screen.getAllByRole("heading")).toHaveLength(4)
  })
  it("keeps native selects labelled and preserves selection changes and listbox semantics", () => {
    const change = vi.fn()
    const { rerender } = render(<Field label="Dataset"><Select defaultValue="b" onChange={change}><option value="a">Dataset A</option><option value="b">Dataset B</option></Select></Field>)
    expect(screen.getByRole("combobox", { name: "Dataset" })).toHaveValue("b")
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } })
    expect(change).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("combobox")).toHaveValue("a")
    rerender(<Field label="Datasets"><Select multiple defaultValue={["b"]}><option value="a">Dataset A</option><option value="b">Dataset B</option></Select></Field>)
    expect(screen.getByRole("listbox", { name: "Datasets" })).toHaveValue(["b"])
    rerender(<Field label="Visible datasets"><Select size={3}><option>Dataset A</option></Select></Field>)
    expect(screen.getByRole("listbox", { name: "Visible datasets" })).toBeVisible()
  })
  it("assigns feedback roles and respects explicit caller roles", () => {
    const { rerender } = render(<><Alert variant="destructive">Load failed</Alert><Alert variant="success">Saved</Alert><Alert>Note</Alert></>)
    expect(screen.getByRole("alert")).toHaveTextContent("Load failed")
    expect(screen.getByRole("status")).toHaveTextContent("Saved")
    expect(screen.getByText("Note")).not.toHaveAttribute("role")
    rerender(<Alert variant="destructive" role="status">Recovering</Alert>)
    expect(screen.getByRole("status")).toHaveTextContent("Recovering")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it.each(["title", "section", "body", "caption", "overline", "metric-lg", "metric-md", "data", "data-sm"])("merges custom %s type independently from semantic colors", (size) => {
    expect(cn(`text-${size}`, "text-fg-muted")).toBe(`text-${size} text-fg-muted`)
    expect(cn("text-fg-muted", `text-${size}`)).toBe(`text-fg-muted text-${size}`)
  })

  it("still replaces conflicting text sizes and colors independently", () => {
    expect(cn("text-caption text-fg-muted", "text-metric-lg text-destructive")).toBe("text-metric-lg text-destructive")
    expect(cn("text-body text-success", "text-sm text-fg")).toBe("text-sm text-fg")
    expect(cn("text-sm text-fg", "text-body text-success")).toBe("text-body text-success")
  })
})
