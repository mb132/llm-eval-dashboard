import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatMs, formatPercent, formatTokens, formatUsd } from "@/lib/format"

/**
 * API-independent profile data, in comparison-table order. Scores are fractions
 * (0.45 = 45%); latency is milliseconds, tokens a count, and cost numeric USD.
 * Use null for absent or incomplete aggregates: partial data must not lead an
 * axis. Nonfinite and negative values are also treated as missing.
 */
export type ComparisonChartRow = {
  id: string
  name: string
  quality: number | null
  latency: number | null
  tokens: number | null
  cost: number | null
  security: number | null
}

const axes = [
  { key: "quality", label: "Quality", direction: "higher", format: formatPercent },
  { key: "latency", label: "Latency", direction: "lower", format: formatMs },
  { key: "tokens", label: "Tokens", direction: "lower", format: formatTokens },
  { key: "cost", label: "Est. cost", direction: "lower", format: formatUsd },
  { key: "security", label: "Security", direction: "higher", format: formatPercent },
] as const
const seriesColors = ["var(--le-series-1)", "var(--le-series-2)", "var(--le-series-3)", "var(--le-series-4)"]
const seriesColor = (index: number) => seriesColors[index] ?? "var(--le-accent-muted)"
const finiteValue = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? value : null
const axisX = (index: number) => `${10 + index * 20}%`
const pointY = (value: number) => 30 + (1 - value) * 140
const missingLabel = (key: string) => key === "cost" ? "no price" : "no data"

function segments(points: (string | null)[]) {
  const result: string[] = []
  let current: string[] = []
  for (const point of [...points, null]) {
    if (point !== null) current.push(point)
    else {
      if (current.length > 1) result.push(current.join(" "))
      current = []
    }
  }
  return result
}

/** A panel with a relative profile, highlightable legend and exact-value table. */
export function ComparisonChart({ rows }: { rows: readonly ComparisonChartRow[] }) {
  const titleId = useId()
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const axisData = axes.map((axis) => {
    const values = rows.map((row) => finiteValue(row[axis.key]))
    const available = values.filter((value): value is number => value !== null)
    const best = available.length === 0 ? null : available.reduce((a, b) => axis.direction === "higher" ? Math.max(a, b) : Math.min(a, b))
    return {
      ...axis,
      values,
      best,
      normalized: values.map((value) => {
        if (value === null || best === null) return null
        // 0/0 represents a tied best, while a positive value against a zero
        // lower-better best is at the bottom. All-zero axes are tied at top.
        if (value === best) return 1
        return axis.direction === "higher" ? value / best : best / value
      }),
      leaders: rows.filter((_, index) => best !== null && values[index] === best).map((row) => row.name),
    }
  })
  const summary = `Relative profile. ${axisData.map((axis) => axis.best === null ? `${axis.label}: no data.` : `${axis.label}: ${axis.leaders.join(", ")} ${axis.leaders.length === 1 ? "leads" : "tie for best"}.`).join(" ")}`
  const tableOnly = rows.length > 4

  return <Card className="min-w-0" role="region" aria-labelledby={titleId}>
    <CardHeader>
      <CardTitle id={titleId}>Relative profile</CardTitle>
      <CardDescription>Top = best in this run. Latency, tokens and cost are inverted; exact values are in the table.</CardDescription>
    </CardHeader>
    <CardContent className="min-w-0 px-2 pb-2 pt-3 md:px-4">
      {rows.length === 0 ? <p className="text-body text-fg-muted">No comparison data.</p> : tableOnly ? <p className="px-2 text-caption text-fg-muted">More than four series: compare exact values in the table.</p> : <svg width="100%" height="236" className="block" role="img" aria-label={summary}>
        <g className="stroke-line" strokeDasharray="3 4">
          {[30, 100, 170].map((y) => <line key={y} x1="5%" x2="95%" y1={y} y2={y} />)}
        </g>
        <text x="5%" y="20" className="fill-fg-muted font-mono text-data-sm md:hidden">best</text>
        <g className="hidden fill-fg-muted font-mono text-data-sm md:block" textAnchor="end">
          {[{ y: 34, label: "best" }, { y: 104, label: "50%" }, { y: 174, label: "0" }].map((tick) => <text key={tick.label} x="5%" dx="-8" y={tick.y}>{tick.label}</text>)}
        </g>
        {axisData.map((axis, index) => <g key={axis.key}>
          <line x1={axisX(index)} x2={axisX(index)} y1="30" y2="170" className="stroke-line-strong" strokeDasharray={axis.key === "security" && axis.best === null ? "2 4" : undefined} />
          <text x={axisX(index)} y="200" textAnchor="middle" className="fill-fg-secondary font-sans text-caption">{axis.label}</text>
          <text x={axisX(index)} y="218" textAnchor="middle" className="hidden fill-fg-muted font-mono text-data-sm md:block">{axis.best === null ? missingLabel(axis.key) : axis.direction}</text>
          <text x={axisX(index)} y="218" textAnchor="middle" className="fill-fg-muted font-mono text-data-sm md:hidden">{axis.best === null ? missingLabel(axis.key) : axis.values.some((value) => value === null) ? `${axis.values.filter((value) => value === null).length} n/a` : axis.direction}</text>
        </g>)}
        {rows.map((row, rowIndex) => {
          const values = axisData.map((axis) => axis.normalized[rowIndex])
          return <g key={row.id} data-series={row.id} opacity={highlighted === null || highlighted === row.id ? 1 : 0.18} style={{ color: seriesColor(rowIndex) }}>
            {/* Stretch geometry only; outer labels retain their CSS font size on mobile. */}
            <svg x="10%" y="30" width="80%" height="140" viewBox="0 0 4 1" preserveAspectRatio="none" overflow="visible" aria-hidden="true">
              {segments(values.map((value, index) => value === null ? null : `${index},${1 - value}`)).map((points, index) => <polyline key={index} points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
            </svg>
            {axisData.map((axis, index) => {
              const value = values[index]
              const label = value === null ? missingLabel(axis.key) : axis.format(axis.values[rowIndex])
              return <g key={axis.key}>
                <circle data-axis={axis.key} data-missing={value === null || undefined} cx={axisX(index)} cy={pointY(value ?? 0)} r="4" stroke="currentColor" strokeWidth="2" className={value === null ? "fill-panel" : rowIndex === 3 ? "fill-current [[data-theme=light]_&]:fill-panel" : "fill-current"}>
                  <title>{row.name} · {axis.label}: {label}</title>
                </circle>
                <text x={axisX(index)} dx={index === 4 ? -8 : 8} y={Math.min(184, pointY(value ?? 0) - 8 + rowIndex * 12)} textAnchor={index === 4 ? "end" : "start"} className={`hidden font-mono text-data-sm md:block ${value === null ? "fill-fg-muted" : "fill-fg"}`}>{label}</text>
              </g>
            })}
          </g>
        })}
      </svg>}
      <div role="group" aria-label="Highlight comparison series" className="flex flex-wrap gap-x-4 gap-y-2 px-2 py-2">
        {rows.map((row, index) => <Button key={row.id} type="button" variant="ghost" size="xs" aria-pressed={highlighted === row.id} onClick={() => setHighlighted((current) => current === row.id ? null : row.id)} className="h-auto min-h-11 min-w-0 max-w-full justify-start whitespace-normal text-left text-caption md:min-h-7">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full border-2 ${index === 3 ? "bg-current [[data-theme=light]_&]:bg-panel" : ""}`} style={{ borderColor: seriesColor(index), backgroundColor: index === 3 ? undefined : seriesColor(index), color: seriesColor(index) }} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{row.name}</span>
        </Button>)}
        <span className="text-caption text-fg-muted">○ value unavailable</span>
      </div>
      <div className={tableOnly ? "min-w-0" : "sr-only"}>
        <Table aria-label="Relative profile exact values" className={tableOnly ? "min-w-[560px]" : undefined}>
          <TableHeader><TableRow><TableHead scope="col">Series</TableHead>{axes.map((axis) => <TableHead key={axis.key} scope="col" className="text-right">{axis.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{rows.map((row) => <TableRow key={row.id}>
            <TableHead scope="row" className="whitespace-normal [overflow-wrap:anywhere]">{row.name}</TableHead>
            {axes.map((axis) => <TableCell key={axis.key} className="text-right font-mono">{finiteValue(row[axis.key]) === null ? missingLabel(axis.key) : axis.format(row[axis.key])}</TableCell>)}
          </TableRow>)}</TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
}
