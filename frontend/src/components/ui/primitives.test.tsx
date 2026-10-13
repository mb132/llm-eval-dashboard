import { createRef, useState } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MetricCell, MetricStrip } from "./metric-strip"
import { MeterBar, SplitBar } from "./meter"
import { SegmentedControl } from "./segmented-control"
import { OptionList, SelectableRow } from "./option-list"
import { StepPanel } from "./step-panel"
import { InsetPane, ResultPanes } from "./inset-pane"
import { InlineConfirm } from "./inline-confirm"
import { EmptyState, ErrorState, LoadingState } from "./states"

describe("redesign primitives", () => {
  it("shows missing metrics without dropping their reason and preserves zero and units", () => {
    render(<MetricStrip><MetricCell label="Security" subValue="No security cases in dataset" /><MetricCell label="Avg latency" value={0} unit="ms" /></MetricStrip>)
    expect(screen.getByText("—")).toBeVisible()
    expect(screen.getByText("No security cases in dataset")).toBeVisible()
    expect(screen.getByText("ms").parentElement).toHaveTextContent("0 ms")
  })

  it.each([[1.5, 1], [-1, 0], [NaN, 0], [Infinity, 0], [0.45, 0.45]])("clamps meter %s to %s", (value, expected) => {
    render(<MeterBar value={value} aria-label="Contains score" />)
    const meter = screen.getByRole("meter", { name: "Contains score" })
    expect(meter).toHaveAttribute("aria-valuemin", "0")
    expect(meter).toHaveAttribute("aria-valuemax", "1")
    expect(meter).toHaveAttribute("aria-valuenow", String(expected))
    expect(meter.firstElementChild).toHaveStyle({ width: `${expected * 100}%` })
  })

  it("allows decorative meters and normalizes raw split weights safely", () => {
    const { container } = render(<><MeterBar value={0.5} aria-hidden /><SplitBar aria-label="Run progress" role="progressbar" value={2} segments={[{ value: Number.MAX_VALUE, tone: "success" }, { value: Number.MAX_VALUE, tone: "info" }, { value: NaN, tone: "destructive" }, { value: -1, tone: "line" }]} /></>)
    expect(screen.queryByRole("meter")).not.toBeInTheDocument()
    const progress = screen.getByRole("progressbar", { name: "Run progress" })
    expect(progress).toHaveAttribute("aria-valuenow", "1")
    expect(progress.children).toHaveLength(2)
    expect(progress.children[0]).toHaveStyle({ flexGrow: "0.5" })
    expect(progress.children[1]).toHaveStyle({ flexGrow: "0.5" })
    expect(container.innerHTML).not.toContain("NaN")
  })

  it("supports empty split outcomes without invalid sizing", () => {
    const { container } = render(<SplitBar aria-hidden segments={[{ value: 0, tone: "success" }, { value: Infinity, tone: "line" }]} />)
    expect(container.firstElementChild?.children).toHaveLength(0)
  })

  it("navigates tabs, wraps, skips disabled items, and links panel IDs", () => {
    function Tabs() {
      const [value, setValue] = useState("models")
      return <><SegmentedControl id="comparison" label="Comparison" value={value} onValueChange={setValue} options={[{ value: "models", label: "Models", panelId: "model-table" }, { value: "disabled", label: "Unavailable", disabled: true }, { value: "prompts", label: "Prompt versions", count: 2 }]} /><div role="tabpanel" id="model-table" aria-labelledby="comparison-models-tab" hidden={value !== "models"}>Models table</div><div role="tabpanel" id="comparison-prompts-panel" aria-labelledby="comparison-prompts-tab" hidden={value !== "prompts"}>Prompts table</div></>
    }
    render(<Tabs />)
    const models = screen.getByRole("tab", { name: "Models" })
    const prompts = screen.getByRole("tab", { name: "Prompt versions 2" })
    expect(models).toHaveAttribute("aria-controls", "model-table")
    models.focus()
    fireEvent.keyDown(models, { key: "ArrowRight" })
    expect(prompts).toHaveFocus()
    expect(prompts).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Prompt versions 2")
    fireEvent.keyDown(prompts, { key: "ArrowRight" })
    expect(models).toHaveFocus()
    fireEvent.keyDown(models, { key: "End" })
    expect(prompts).toHaveFocus()
    fireEvent.keyDown(prompts, { key: "Home" })
    expect(models).toHaveFocus()
    fireEvent.keyDown(models, { key: "ArrowLeft" })
    expect(prompts).toHaveFocus()
    expect(models).toHaveAttribute("tabindex", "-1")
    expect(prompts).toHaveAttribute("tabindex", "0")
  })

  it("uses the first enabled tab as a fallback tab stop and accepts clicks", () => {
    const change = vi.fn()
    render(<SegmentedControl label="Views" value="missing" onValueChange={change} options={[{ value: "a", label: "A", disabled: true }, { value: "b", label: "B" }]} />)
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("tabindex", "0")
    fireEvent.click(screen.getByRole("tab", { name: "B" }))
    expect(change).toHaveBeenCalledExactlyOnceWith("b")
  })

  it("uses a named native radio group for value selection", () => {
    function Radios() {
      const [value, setValue] = useState("1")
      return <SegmentedControl mode="radio" label="Repetitions" value={value} onValueChange={setValue} name="repeat" options={[{ value: "1", label: "Once" }, { value: "2", label: "Twice" }, { value: "3", label: "Three times", disabled: true }]} />
    }
    render(<Radios />)
    const group = screen.getByRole("group", { name: "Repetitions" })
    expect(within(group).getByRole("radio", { name: "Once" })).toBeChecked()
    fireEvent.click(screen.getByText("Twice"))
    expect(screen.getByRole("radio", { name: "Twice" })).toBeChecked()
    expect(screen.getByRole("radio", { name: "Once" })).not.toBeChecked()
    expect(screen.getByRole("radio", { name: "Twice" })).toHaveAttribute("name", "repeat")
    expect(screen.getByRole("radio", { name: "Three times" })).toBeDisabled()
  })

  it("makes full rows labels with checkbox changes and visible disabled reasons", () => {
    const change = vi.fn()
    render(<StepPanel step={1} title="Models" caption="One or more" count="1 of 2"><OptionList><SelectableRow label="Model A" checked={false} description="provider model-a" onCheckedChange={change} /><SelectableRow label="Model B" description="Provider disabled" disabled checked={false} onCheckedChange={change} /></OptionList></StepPanel>)
    const group = screen.getByRole("group", { name: "1 Models" })
    expect(within(group).getByText("1 of 2")).toBeVisible()
    const enabled = screen.getByRole("checkbox", { name: "Model A provider model-a" })
    expect(enabled).toHaveAccessibleDescription("provider model-a")
    fireEvent.click(screen.getByText("Model A"))
    expect(change).toHaveBeenCalledExactlyOnceWith(true)
    expect(screen.getByRole("checkbox", { name: "Model B Provider disabled" })).toBeDisabled()
  })

  it("preserves native radio rows and external descriptions", () => {
    render(<><p id="reason">Exactly one</p><OptionList><SelectableRow type="radio" name="dataset" value="a" label="Dataset A" description="3 cases" checked aria-describedby="reason" onCheckedChange={() => {}} /></OptionList></>)
    expect(screen.getByRole("radio")).toHaveAccessibleDescription("Exactly one 3 cases")
    expect(screen.getByRole("radio")).toBeChecked()
  })

  it("names read-only panes and preserves multiline, long text and verdicts", () => {
    const text = `line one\n${"a".repeat(500)}`
    render(<ResultPanes><InsetPane label="Input">{text}</InsetPane><InsetPane label="Expected" mono>Expected answer</InsetPane><InsetPane label="Generated" verdict="✕ expected text not found">Response</InsetPane></ResultPanes>)
    expect(screen.getByRole("region", { name: "Input" }).textContent).toContain(text)
    expect(screen.getByRole("region", { name: "Generated" })).toHaveTextContent("✕ expected text not found")
  })

  it("focuses Cancel, handles Escape, and restores the trigger when closed", () => {
    function Confirmation() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>Delete trigger</button><InlineConfirm open={open} label="Delete case 4" message="Delete case 4? Past runs keep their snapshot." confirmLabel="Delete case" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} /></>
    }
    render(<Confirmation />)
    const trigger = screen.getByRole("button", { name: "Delete trigger" })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole("alertdialog", { name: "Delete case 4" })).toBeVisible()
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription("Delete case 4? Past runs keep their snapshot.")
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAccessibleDescription("Delete case 4? Past runs keep their snapshot.")
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" })
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("uses explicit return focus, invokes actions and blocks pending confirmation", () => {
    const cancel = vi.fn()
    const confirm = vi.fn()
    const target = createRef<HTMLButtonElement>()
    const { rerender } = render(<><button ref={target}>Cases</button><InlineConfirm message="Discard changes?" confirmLabel="Discard changes" onCancel={cancel} onConfirm={confirm} returnFocusRef={target} /></>)
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }))
    expect(confirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(cancel).toHaveBeenCalledTimes(1)
    rerender(<><button ref={target}>Cases</button><InlineConfirm message="Discard changes?" confirmLabel="Discard changes" pending onCancel={cancel} onConfirm={confirm} returnFocusRef={target} /></>)
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled()
    rerender(<><button ref={target}>Cases</button><InlineConfirm open={false} message="Discard changes?" confirmLabel="Discard changes" onCancel={cancel} onConfirm={confirm} returnFocusRef={target} /></>)
    expect(screen.getByRole("button", { name: "Cases" })).toHaveFocus()
  })

  it("announces loading, provides empty guidance and retries load errors", () => {
    const retry = vi.fn()
    const { rerender } = render(<LoadingState label="Loading runs…" rows={99} />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading runs…")
    rerender(<EmptyState title="No completed evaluations yet" description="Create an evaluation to compare results." action={<button>New evaluation</button>} />)
    expect(screen.getByText("No completed evaluations yet")).toBeVisible()
    expect(screen.getByRole("button", { name: "New evaluation" })).toBeVisible()
    rerender(<ErrorState message="Unable to load runs" onRetry={retry} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load runs")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledTimes(1)
    rerender(<ErrorState message="Unable to load runs" onRetry={retry} retrying />)
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled()
  })

  it("opens pending confirmations with enabled Cancel focused", () => {
    render(<InlineConfirm pending message="Delete case?" confirmLabel="Delete case" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    expect(screen.getByRole("button", { name: "Delete case" })).toBeDisabled()
  })

  it("disables native selection controls through their step fieldset", () => {
    render(<StepPanel disabled step={2} title="Dataset" padded={false}><OptionList embedded><SelectableRow type="radio" name="dataset" label="Dataset A" checked={false} onCheckedChange={() => {}} /></OptionList></StepPanel>)
    expect(screen.getByRole("radio", { name: "Dataset A" })).toBeDisabled()
  })
})
