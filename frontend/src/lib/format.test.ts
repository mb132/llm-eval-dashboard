import { describe, expect, it } from "vitest"

import {
  formatDateTime,
  formatInt,
  formatMs,
  formatPercent,
  formatPricePerMillion,
  formatShortDate,
  formatTokens,
  formatUsd,
} from "./format"

describe("number formatting", () => {
  it.each([
    [0, "0"],
    [9_009, "9,009"],
    [3_757.5, "3,758"],
    [3_757.49, "3,757"],
    [-0, "0"],
    [-0.1, "0"],
  ])("formats %s as the integer %s", (value, expected) => {
    expect(formatInt(value)).toBe(expected)
  })

  it("rounds latency and includes its unit", () => {
    expect(formatMs(9_861)).toBe("9,861 ms")
    expect(formatMs(3_757.5)).toBe("3,758 ms")
    expect(formatMs(0)).toBe("0 ms")
  })

  it.each([
    [0, "0.0%"],
    [0.45, "45.0%"],
    [1, "100.0%"],
    [0.12349, "12.3%"],
    [0.1235, "12.4%"],
    [-0, "0.0%"],
  ])("formats fractional score %s as %s", (value, expected) => {
    expect(formatPercent(value)).toBe(expected)
  })

  it.each([
    [0, "0"],
    [1_396, "1,396"],
    [9_999, "9,999"],
    [10_000, "10.0k"],
    [101_300, "101.3k"],
    [101_349, "101.3k"],
    [101_350, "101.4k"],
    [1_000_000, "1,000.0k"],
  ])("formats token count %s as %s", (value, expected) => {
    expect(formatTokens(value)).toBe(expected)
  })

  it.each([null, undefined, NaN, Infinity, -Infinity])("shows missing numeric data %s as an em dash", (value) => {
    for (const format of [formatInt, formatMs, formatPercent, formatTokens]) {
      expect(format(value)).toBe("—")
    }
  })
})

describe("USD formatting", () => {
  it.each([
    [0, "$0"],
    [-0, "$0"],
    [0.018609, "$0.018609"],
    [0.42, "$0.42"],
    ["0.004200", "$0.0042"],
    ["0.010000", "$0.01"],
    ["0.000001", "$0.000001"],
    ["0.00000049", "$0"],
    ["0.0000005", "$0.000001"],
    ["0.0186094", "$0.018609"],
    ["0.0186095", "$0.01861"],
    ["0.9999994", "$0.999999"],
    ["0.9999995", "$1"],
    [1, "$1.00"],
    [12.3, "$12.30"],
    ["12.304", "$12.30"],
    ["12.305", "$12.31"],
    [1_234.5, "$1,234.50"],
    [" 0.42 ", "$0.42"],
  ])("formats USD %s as %s", (value, expected) => {
    expect(formatUsd(value)).toBe(expected)
  })

  it("keeps two decimals for price-per-million rates", () => {
    expect(formatPricePerMillion("1.32")).toBe("$1.32")
    expect(formatPricePerMillion(3.96)).toBe("$3.96")
    expect(formatPricePerMillion(0.42)).toBe("$0.42")
    expect(formatPricePerMillion("0.0042")).toBe("$0.00")
    expect(formatPricePerMillion(0)).toBe("$0.00")
  })

  it.each([null, undefined, NaN, Infinity, -Infinity, "", " ", "invalid", "NaN", "Infinity", "0x10", "1 USD", "1,000"])("shows invalid USD %s as an em dash", (value) => {
    expect(formatUsd(value)).toBe("—")
    expect(formatPricePerMillion(value)).toBe("—")
  })
})

describe("date formatting", () => {
  const timestamp = "2026-08-31T15:55:00Z"

  it("formats English header and two-line table dates", () => {
    expect(formatDateTime(timestamp, "UTC")).toBe("Aug 31, 2026, 3:55 PM")
    expect(formatShortDate(timestamp, "UTC")).toBe("Aug 31\n3:55 PM")
  })

  it("accepts Date objects and numeric timestamps", () => {
    expect(formatDateTime(new Date(timestamp), "UTC")).toBe("Aug 31, 2026, 3:55 PM")
    expect(formatShortDate(Date.parse(timestamp), "UTC")).toBe("Aug 31\n3:55 PM")
    expect(formatDateTime(0, "UTC")).toBe("Jan 1, 1970, 12:00 AM")
  })

  it("converts timezone across the day and year boundary", () => {
    const nearMidnight = "2026-12-31T23:05:00Z"
    expect(formatDateTime(nearMidnight, "Europe/Berlin")).toBe("Jan 1, 2027, 12:05 AM")
    expect(formatShortDate(nearMidnight, "Europe/Berlin")).toBe("Jan 1\n12:05 AM")
  })

  it("uses the local timezone when no timezone is passed", () => {
    const localDate = new Date(2026, 7, 31, 15, 55)
    expect(formatDateTime(localDate)).toBe("Aug 31, 2026, 3:55 PM")
    expect(formatShortDate(localDate)).toBe("Aug 31\n3:55 PM")
  })

  it.each([null, undefined, "", " ", "invalid", new Date(NaN), NaN, Infinity])("shows invalid date %s as an em dash", (value) => {
    expect(formatDateTime(value, "UTC")).toBe("—")
    expect(formatShortDate(value, "UTC")).toBe("—")
  })

  it("shows an em dash for an invalid explicit timezone", () => {
    expect(formatDateTime(timestamp, "Invalid/Timezone")).toBe("—")
    expect(formatShortDate(timestamp, "Invalid/Timezone")).toBe("—")
  })
})
