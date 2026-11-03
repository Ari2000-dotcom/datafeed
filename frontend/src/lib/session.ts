import { istParts } from "@/lib/format"

export type SessionState = "open" | "pre" | "closed"

export interface Session {
  exchange: "NSE" | "MCX"
  state: SessionState
}

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"])

/**
 * Where each exchange is in its day, from the clock alone: NSE 09:15-15:30 (pre-open from 09:00),
 * MCX 09:00-23:30, Monday to Friday. Exchange holidays are not modelled, so on one of those days
 * this says "open" while the feed sends nothing.
 */
export function sessions(now = Date.now()): Session[] {
  const { weekday, minutes } = istParts(now)
  const trading = WEEKDAYS.has(weekday)
  const nse: SessionState = !trading ? "closed" : minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30 ? "open" : minutes >= 9 * 60 && minutes < 9 * 60 + 15 ? "pre" : "closed"
  const mcx: SessionState = trading && minutes >= 9 * 60 && minutes < 23 * 60 + 30 ? "open" : "closed"
  return [
    { exchange: "NSE", state: nse },
    { exchange: "MCX", state: mcx },
  ]
}

/** Trading hours in minutes after midnight IST: NSE and BSE 09:15-15:30, MCX 09:00-23:30. */
export function tradingHours(id: string): { start: number; end: number } {
  return id.startsWith("mcx:") ? { start: 9 * 60, end: 23 * 60 + 30 } : { start: 9 * 60 + 15, end: 15 * 60 + 30 }
}

/**
 * The candles that belong to the trading session. The feed also sends flat pre-open prints (09:05,
 * 09:10) and closing prints (15:30, 15:35) that no broker's chart draws and that would pass for the
 * day's open and low. Daily candles have no time of day and pass whole.
 */
export function inSession<T extends { time: number }>(id: string, candles: readonly T[], intraday: boolean): T[] {
  if (!intraday) return [...candles]
  const { start, end } = tradingHours(id)
  return candles.filter((c) => {
    const { minutes } = istParts(c.time * 1000)
    return minutes >= start && minutes < end
  })
}
