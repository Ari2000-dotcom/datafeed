import { useEffect, useMemo, useState } from "react"

import { istDate, istParts } from "@/lib/format"
import {
  bySession,
  getCandles,
  storedCandles,
  type Candle,
} from "@/lib/history"
import type { Quote } from "@/lib/hub"
import { inSession, tradingHours } from "@/lib/session"
import { useQuote } from "@/lib/use-hub"

/** What a broker row shows for an instrument: the live price and the session it belongs to. */
export interface DayView {
  quote: Quote | undefined
  /** The last close before this session. */
  prevClose: number | null
  change: number | null
  pct: number | null
  open: number | null
  high: number | null
  low: number | null
  /** The session's 5-minute closes, ending on the live price: a sparkline's points. */
  spark: number[]
  /** Each spark point's minute of the IST day, so a chart can place it on the session's clock. */
  sparkAt: number[]
  /** The session's own 5-minute bars, for a chart drawn on the session's clock. */
  bars: Candle[]
  /** True once the history has arrived, so a row can tell "loading" from "no data". */
  ready: boolean
}

const EMPTY: DayView = {
  quote: undefined,
  prevClose: null,
  change: null,
  pct: null,
  open: null,
  high: null,
  low: null,
  spark: [],
  sparkAt: [],
  bars: [],
  ready: false,
}

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"])

/** True when a stamp falls inside the instrument's trading hours on a weekday. */
function duringHours(id: string, ms: number): boolean {
  const { weekday, minutes } = istParts(ms)
  const { start, end } = tradingHours(id)
  return WEEKDAYS.has(weekday) && minutes >= start && minutes < end
}

function derive(
  id: string | null | undefined,
  candles: Candle[] | null,
  quote: Quote | undefined
): DayView {
  if (!candles) return { ...EMPTY, quote }
  const sessions = bySession(candles).filter((s) => s.candles.length > 0)
  const last = sessions.length - 1
  // The session a row shows is the one the market last traded. Today's counts once it has bars, or once
  // a live tick lands inside trading hours (the first minutes after the open, before a bar closes).
  // Before the open, after the close, over a weekend, or for a replayed price, the last session held
  // is the day shown, measured against the close before it.
  const live = quote && !quote.replay ? quote : undefined
  const today = live
    ? sessions.findIndex((s) => s.date === istDate(live.ts))
    : -1
  const justOpened =
    today < 0 && live !== undefined && id ? duringHours(id, live.ts) : false
  const at = today >= 0 ? today : last
  const session = sessions[at]
  const sessionIsQuoted = Boolean(session) && !justOpened
  const prev = sessionIsQuoted ? sessions[at - 1] : session
  const prevClose = prev ? prev.candles[prev.candles.length - 1]!.close : null

  const own = sessionIsQuoted ? session!.candles : []
  const ltp = quote?.ltp
  let high = own.length ? Math.max(...own.map((c) => c.high)) : null
  let low = own.length ? Math.min(...own.map((c) => c.low)) : null
  if (ltp !== undefined) {
    high = high === null ? ltp : Math.max(high, ltp)
    low = low === null ? ltp : Math.min(low, ltp)
  }
  const change =
    ltp !== undefined && prevClose !== null ? ltp - prevClose : null
  const spark = own.map((c) => c.close)
  const sparkAt = own.map((c) => istParts(c.time * 1000).minutes)
  if (ltp !== undefined && own.length > 0) {
    spark.push(ltp)
    // A live price in today's session stands at its own minute; otherwise it closes the last bar it came after.
    const lastAt = sparkAt[sparkAt.length - 1]!
    sparkAt.push(
      live && today >= 0
        ? Math.max(lastAt, istParts(live.ts).minutes)
        : lastAt + 5
    )
  }
  return {
    quote,
    prevClose,
    change,
    pct: change !== null && prevClose ? (change / prevClose) * 100 : null,
    open: own[0]?.open ?? null,
    high,
    low,
    spark,
    sparkAt,
    bars: own,
    ready: true,
  }
}

/**
 * An instrument's live quote and its day: change against the last close before the quote's session,
 * open, high, low (stretched by the live price) and a sparkline. One request per instrument feeds all
 * of it, shared by every view that shows it (strip, panel, table row, chain header): 5-minute bars
 * over four calendar days, which reach the last close over a weekend. The hub fetches one broker call
 * per weekday in a request either way, so daily bars saved nothing and a second request cost a lot.
 *
 * The last answer this browser stored (same day) is shown at once while a fresh one is fetched, so a
 * reload paints numbers immediately; the live quote moves price, change, high and low on top of it.
 */
export function useDay(id: string | null | undefined): DayView {
  const quote = useQuote(id)
  const [loaded, setLoaded] = useState<{
    id: string
    candles: Candle[]
  } | null>(null)

  // What this browser stored today, read once per instrument: drawn until the fresh answer lands.
  const stored = useMemo(() => {
    const c = id ? storedCandles(id, "5m", 4) : null
    return c ? inSession(id!, c, true) : null
  }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const hadStored = stored !== null
    getCandles(id, "5m", 4, true).then(
      (candles) =>
        !cancelled && setLoaded({ id, candles: inSession(id, candles, true) }),
      // Keep what was stored rather than blank the row when the refresh fails.
      () => !cancelled && !hadStored && setLoaded({ id, candles: [] })
    )
    return () => {
      cancelled = true
    }
  }, [id, stored])

  const candles = loaded && loaded.id === id ? loaded.candles : stored
  // Quotes tick many times a second; the sparkline and range only need to follow when the price moved.
  return useMemo(() => derive(id, candles, quote), [id, candles, quote])
}
