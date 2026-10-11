import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode, useRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"

function FormDialog() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  return <>
    <Button onClick={() => setOpen(true)}>Edit model</Button>
    <Dialog open={open} onOpenChange={(next) => setOpen(next)} title="Model" description="Update the model."
      footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button>Save model</Button></>}>
      <label>Display name<input value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <label>Model ID<input /></label>
    </Dialog>
  </>
}

afterEach(() => {
  document.body.style.overflow = ""
})

describe("Dialog", () => {
  it("starts on the first field and retains focus and scroll lock across inline callback rerenders", async () => {
    const user = userEvent.setup()
    render(<FormDialog />)
    await user.click(screen.getByRole("button", { name: "Edit model" }))
    expect(screen.getByLabelText("Display name")).toHaveFocus()
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Update the model.")
    expect(document.body.style.overflow).toBe("hidden")
    await user.type(screen.getByLabelText("Display name"), "Updated")
    expect(screen.getByLabelText("Display name")).toHaveValue("Updated")
    await user.click(screen.getByLabelText("Model ID"))
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Rerender" } })
    expect(screen.getByLabelText("Model ID")).toHaveFocus()
    expect(document.body.style.overflow).toBe("hidden")
  })

  it("cycles Tab and Shift+Tab through the header, body, and footer", async () => {
    const user = userEvent.setup()
    render(<FormDialog />)
    await user.click(screen.getByRole("button", { name: "Edit model" }))
    await user.tab()
    expect(screen.getByLabelText("Model ID")).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "Save model" })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole("button", { name: "Save model" })).toHaveFocus()
    await user.tab()
    await user.tab()
    expect(screen.getByLabelText("Display name")).toHaveFocus()
  })

  it.each(["Escape", "Close", "Cancel", "backdrop"])("closes with %s and restores the trigger and original scroll setting", async (action) => {
    const user = userEvent.setup()
    document.body.style.overflow = "scroll"
    render(<FormDialog />)
    const trigger = screen.getByRole("button", { name: "Edit model" })
    await user.click(trigger)
    if (action === "Escape") await user.keyboard("{Escape}")
    else if (action === "backdrop") fireEvent.mouseDown(screen.getByRole("presentation"))
    else await user.click(screen.getByRole("button", { name: action }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe("scroll")
  })

  it("does not close on body clicks and uses the latest close callback", () => {
    const previous = vi.fn()
    const current = vi.fn()
    const { rerender } = render(<Dialog open onOpenChange={previous} title="Model"><input aria-label="Name" /></Dialog>)
    rerender(<Dialog open onOpenChange={current} title="Model"><input aria-label="Name" /></Dialog>)
    fireEvent.mouseDown(screen.getByLabelText("Name"))
    expect(current).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(current).toHaveBeenCalledExactlyOnceWith(false)
    expect(previous).not.toHaveBeenCalled()
  })

  it("skips disabled, hidden, inert, and negative tabindex controls and recovers escaped focus", async () => {
    const user = userEvent.setup()
    render(<><button>Outside</button><Dialog open onOpenChange={() => {}} title="Model">
      <input aria-label="Disabled" disabled /><fieldset disabled><input aria-label="Disabled group" /></fieldset>
      <div hidden><input aria-label="Hidden" /></div><div style={{ display: "none" }}><input aria-label="Invisible" /></div>
      <div inert><input aria-label="Inert" /></div><input aria-label="Skipped" tabIndex={-1} />
      <input aria-label="Enabled" /><button disabled>Disabled action</button>
    </Dialog></>)
    expect(screen.getByLabelText("Enabled")).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText("Enabled")).toHaveFocus()
    screen.getByRole("button", { name: "Outside" }).focus()
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement)
  })

  it("falls back to close for content without fields and to the dialog when all controls are disabled", async () => {
    const user = userEvent.setup()
    render(<Dialog open onOpenChange={() => {}} title="Notice"><p>Read this notice.</p></Dialog>)
    const close = screen.getByRole("button", { name: "Close" })
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()
    close.setAttribute("disabled", "")
    await user.tab()
    expect(screen.getByRole("dialog")).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole("dialog")).toHaveFocus()
  })

  it("supports an explicit initial focus target", () => {
    function ExplicitDialog() {
      const target = useRef<HTMLButtonElement>(null)
      return <Dialog open onOpenChange={() => {}} title="Confirm" initialFocusRef={target}>
        <input aria-label="First field" /><Button ref={target}>Keep model</Button>
      </Dialog>
    }
    render(<ExplicitDialog />)
    expect(screen.getByRole("button", { name: "Keep model" })).toHaveFocus()
  })

  it("keeps one Tab stop per named radio group and treats separate forms independently", async () => {
    const user = userEvent.setup()
    render(<Dialog open onOpenChange={() => {}} title="Pricing" footer={<Button>Save</Button>}>
      <form>
        <input type="radio" name="mode" aria-label="Automatic" />
        <input type="radio" name="mode" aria-label="Manual" defaultChecked />
      </form>
      <form>
        <input type="radio" name="mode" aria-label="Unavailable" disabled />
        <input type="radio" name="mode" aria-label="Catalog" />
        <input type="radio" name="mode" aria-label="Custom" />
      </form>
    </Dialog>)
    expect(screen.getByLabelText("Manual")).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText("Catalog")).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByLabelText("Catalog")).toHaveFocus()
    await user.click(screen.getByLabelText("Custom"))
    await user.tab({ shift: true })
    expect(screen.getByLabelText("Manual")).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText("Custom")).toHaveFocus()
  })

  it("cleans up listeners, scroll lock, and focus under StrictMode and unmount", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { unmount } = render(<StrictMode><Dialog open onOpenChange={onClose} title="Model"><input aria-label="Name" /></Dialog></StrictMode>)
    expect(screen.getByLabelText("Name")).toHaveFocus()
    expect(document.body.style.overflow).toBe("hidden")
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false)
    unmount()
    expect(document.body.style.overflow).toBe("")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("gives dialogs distinct heading and description IDs and locks scroll until the last dialog closes", () => {
    const firstClose = vi.fn()
    const secondClose = vi.fn()
    const { rerender } = render(<>
      <Dialog open onOpenChange={firstClose} title="First" description="First description"><input aria-label="First field" /></Dialog>
      <Dialog open onOpenChange={secondClose} title="Second" description="Second description"><input aria-label="Second field" /></Dialog>
    </>)
    const first = screen.getByRole("dialog", { name: "First" })
    const second = screen.getByRole("dialog", { name: "Second" })
    expect(first.getAttribute("aria-labelledby")).not.toBe(second.getAttribute("aria-labelledby"))
    expect(first.getAttribute("aria-describedby")).not.toBe(second.getAttribute("aria-describedby"))
    expect(first).toHaveAccessibleDescription("First description")
    expect(second).toHaveAccessibleDescription("Second description")
    expect(within(second).getByRole("textbox")).toHaveFocus()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(firstClose).not.toHaveBeenCalled()
    expect(secondClose).toHaveBeenCalledExactlyOnceWith(false)
    rerender(<>
      <Dialog open onOpenChange={firstClose} title="First" description="First description"><input aria-label="First field" /></Dialog>
      <Dialog open={false} onOpenChange={secondClose} title="Second"><input /></Dialog>
    </>)
    expect(document.body.style.overflow).toBe("hidden")
    expect(screen.getByLabelText("First field")).toHaveFocus()
    rerender(<Dialog open={false} onOpenChange={firstClose} title="First"><input /></Dialog>)
    expect(document.body.style.overflow).toBe("")
  })

  it("omits description linkage when there is no description", () => {
    render(<Dialog open onOpenChange={() => {}} title="Notice"><p>Details</p></Dialog>)
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby")
  })
})
