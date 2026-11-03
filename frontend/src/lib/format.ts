/** Number, time and date formats. Indian digit grouping (1,23,456.00) throughout. */

/** The minus sign, not a hyphen: same width as "+" in Inter's tabular figures, so signed columns line up. */
export const MINUS = "−"

const two = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 2 })

export const fmt2 = (v: number): string => two.format(v)
export const fmt0 = (v: number): string => whole.format(v)
export const fmtCompact = (v: number): string => compact.format(v)

/** "+123.45" / "−123.45". Zero carries no sign. */
export function signed(v: number, digits = 2): string {
  const abs = Math.abs(v)
  const body = digits === 2 ? two.format(abs) : abs.toFixed(digits)
  if (abs < 0.5 * 10 ** -digits) return body
  return `${v > 0 ? "+" : MINUS}${body}`
}

export const signedPct = (v: number): string => `${signed(v)}%`

export type Tone = "up" | "down" | "flat"

export function toneOf(change: number | null | undefined): Tone {
  if (change === null || change === undefined || Math.abs(change) < 0.005) return "flat"
  return change > 0 ? "up" : "down"
}

// --- India Standard Time ----------------------------------------------------

const IST = "Asia/Kolkata"
const istDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" })
const istClockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
const istPartsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: IST, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })

/** `YYYY-MM-DD` of an instant, in IST: the calendar a trading session is named by. */
export const istDate = (ms: number): string => istDateFmt.format(ms)

/** `14:32:08` in IST. */
export const istClock = (ms: number): string => istClockFmt.format(ms)

export function istParts(ms: number): { weekday: string; minutes: number } {
  const parts = istPartsFmt.formatToParts(ms)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return { weekday: get("weekday"), minutes: Number(get("hour")) * 60 + Number(get("minute")) }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `2026-11-06` -> `06 Nov 2026`: one date format, three-letter months, the year always. */
export function dateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-")
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`
}

/** `2026-11-06` -> `06 Nov`; the year only when it is not this one: `28 Sep 2027`. */
export function expiryLabel(ymd: string, now = Date.now()): string {
  const [y, m, d] = ymd.split("-")
  return `${d} ${MONTHS[Number(m) - 1]}${y === istDate(now).slice(0, 4) ? "" : ` ${y}`}`
}

/** Whole days from today (IST) to a `YYYY-MM-DD`: 0 on the day itself. */
export function daysTo(ymd: string, now = Date.now()): number {
  return Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${istDate(now)}T00:00:00Z`)) / 86_400_000)
}

/** The nearest expiry that has not passed; today's counts until the day is over. */
export function nearestExpiry(expiries: readonly string[], now = Date.now()): string | undefined {
  const today = istDate(now)
  return expiries.find((d) => d >= today) ?? expiries[expiries.length - 1]
}

const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: IST, weekday: "short" })

/** `Fri 30 Oct`, for a `YYYY-MM-DD` session. */
export const sessionLabel = (ymd: string): string => {
  const [, m, d] = ymd.split("-")
  return `${weekdayFmt.format(new Date(`${ymd}T12:00:00+05:30`))} ${d} ${MONTHS[Number(m) - 1]}`
}

/** The last `n` weekdays before today (IST), newest first. Exchange holidays are the hub's to refuse. */
export function pastWeekdays(n: number, now = Date.now()): string[] {
  const out: string[] = []
  let d = new Date(`${istDate(now)}T12:00:00+05:30`)
  while (out.length < n) {
    d = new Date(d.getTime() - 86_400_000)
    const weekday = new Date(`${istDate(d.getTime())}T12:00:00+05:30`).getUTCDay()
    if (weekday !== 0 && weekday !== 6) out.push(istDate(d.getTime()))
  }
  return out
}
