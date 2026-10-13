type NumericValue = number | null | undefined
type DateValue = string | number | Date | null | undefined

const missing = "—"
const locale = "en-US"
const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat(locale, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const percent = new Intl.NumberFormat(locale, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const dollars = new Intl.NumberFormat(locale, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const fractionalDollars = new Intl.NumberFormat(locale, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
})

function isFiniteNumber(value: NumericValue): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** Rounded integer with deterministic English thousands separators. */
export function formatInt(value: NumericValue): string {
  return isFiniteNumber(value) ? integer.format(Math.round(value) || 0) : missing
}

export function formatMs(value: NumericValue): string {
  return isFiniteNumber(value) ? `${formatInt(value)} ms` : missing
}

/** Accepts fractional API scores: 0.45 means 45.0%, not 0.45%. */
export function formatPercent(value: NumericValue): string {
  return isFiniteNumber(value) ? percent.format(value || 0) : missing
}

function parseUsd(value: number | string | null | undefined): number | null {
  if (typeof value === "string") {
    // API costs are decimal strings. Reject blanks, hex and non-numeric text.
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
      return null
    }
    value = Number(value)
  }
  return isFiniteNumber(value) ? value : null
}

/**
 * API decimal strings and numeric USD values are supported. Below $1, round
 * to at most six fractional digits and trim trailing zeroes (tiny costs can
 * round to $0). At $1 and above, always show two fractional digits.
 */
export function formatUsd(value: number | string | null | undefined): string {
  const amount = parseUsd(value)
  if (amount === null) return missing
  return (Math.abs(amount) >= 1 ? dollars : fractionalDollars).format(amount || 0)
}

/** Pricing rates always use two decimals, including rates below $1 per 1M. */
export function formatPricePerMillion(value: number | string | null | undefined): string {
  const amount = parseUsd(value)
  return amount === null ? missing : dollars.format(amount || 0)
}

/** Counts below 10,000 stay integers; larger counts use one decimal in k. */
export function formatTokens(value: NumericValue): string {
  if (!isFiniteNumber(value)) return missing
  return Math.abs(value) >= 10_000
    ? `${oneDecimal.format(value / 1_000)}k`
    : formatInt(value)
}

function dateParts(value: DateValue, timeZone?: string): Record<string, string> | null {
  if (value === null || value === undefined || value === "") return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  try {
    return Object.fromEntries(
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone,
      }).formatToParts(date).map(({ type, value: part }) => [type, part]),
    )
  } catch {
    return null
  }
}

/** English header date-time in the user's local timezone by default. */
export function formatDateTime(value: DateValue, timeZone?: string): string {
  const parts = dateParts(value, timeZone)
  return parts
    ? `${parts.month} ${parts.day}, ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod}`
    : missing
}

/** Table date and time separated by a newline; local timezone by default. */
export function formatShortDate(value: DateValue, timeZone?: string): string {
  const parts = dateParts(value, timeZone)
  return parts
    ? `${parts.month} ${parts.day}\n${parts.hour}:${parts.minute} ${parts.dayPeriod}`
    : missing
}
