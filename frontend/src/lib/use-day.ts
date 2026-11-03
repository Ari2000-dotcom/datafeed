import { useEffect, useMemo, useState } from "react"

import { istDate } from "@/lib/format"
import { bySession, getCandles, type Candle } from "@/lib/history"
import type { Quote } from "@/lib/hub"
import { inSession } from "@/lib/session"
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
  /** True once the history has arrived, so a row can tell "loading" from "no data". */
  ready: boolean
}

const EMPTY: DayView = { quote: undefined, prevClose: null, change: null, pct: null, open: null, high: null, low: null, spark: [], ready: false }

function derive(candles: Candle[] | null, quote: Quote | undefined): DayView {
  if (!candles) return { ...EMPTY, quote }
  const sessions = bySession(candles).filter((s) => s.candles.length > 0)
  // A live quote belongs to its own day's session. A replayed one is the broker's last known price,
  // and the broker re-sends it with a fresh stamp (after midnight, say): it belongs to the last
  // session held, so Friday's close over a weekend is still measured against Thursday's.
  const wanted = quote && !quote.replay ? istDate(quote.ts) : sessions[sessions.length - 1]?.date
  let at = sessions.findIndex((s) => s.date === wanted)
  // No candle yet for the quote's session (it just opened): the last session held is yesterday's, and its close is the reference.
  if (at < 0) at = sessions.length - 1
  const session = sessions[at]
  const sessionIsQuoted = session && wanted === session.date
  const prev = sessionIsQuoted ? sessions[at - 1] : session
  const prevClose = prev ? prev.candles[prev.candles.length - 1]!.close : null

  const own = sessionIsQuoted ? session.candles : []
  const ltp = quote?.ltp
  let high = own.length ? Math.max(...own.map((c) => c.high)) : null
  let low = own.length ? Math.min(...own.map((c) => c.low)) : null
  if (ltp !== undefined) {
    high = high === null ? ltp : Math.max(high, ltp)
    low = low === null ? ltp : Math.min(low, ltp)
  }
  const change = ltp !== undefined && prevClose !== null ? ltp - prevClose : null
  const spark = own.map((c) => c.close)
  if (ltp !== undefined && own.length > 0) spark.push(ltp)
  return {
    quote,
    prevClose,
    change,
    pct: change !== null && prevClose ? (change / prevClose) * 100 : null,
    open: own[0]?.open ?? null,
    high,
    low,
    spark,
    ready: true,
  }
}

/**
 * An instrument's live quote and its day: change against the last close before the quote's session,
 * open, high, low (stretched by the live price) and a sparkline. One history request per instrument,
 * shared and paced, feeds all of it: 5-minute bars when a sparkline is drawn, else daily bars, a
 * handful of numbers each and charged one day of the guest allowance rather than one per weekday.
 */
/**
 * An index's card asks for 5-minute bars for its sparkline, and those bars carry everything a strip
 * or a table row needs too. So an index always asks for them: the strip, the row and the card share
 * one request instead of sending a second one for daily bars (the hub answers one at a time). A
 * future's row, with no card, keeps the lighter daily request.
 */
const isIndex = (id: string) => !id.startsWith("mcx:") && !id.endsWith(":FUT")

export function useDay(id: string | null | undefined, { spark = true }: { spark?: boolean } = {}): DayView {
  const quote = useQuote(id)
  const [loaded, setLoaded] = useState<{ id: string; candles: Candle[] } | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    // The hub fetches a request as one broker call per weekday in it, so four calendar days (today and
    // the session or two before) is as far back as a row looks; it reaches the last close over a weekend.
    const intraday = spark || isIndex(id)
    const request = getCandles(id, intraday ? "5m" : "1d", 4, true)
    request.then(
      (candles) => !cancelled && setLoaded({ id, candles: inSession(id, candles, intraday) }),
      () => !cancelled && setLoaded({ id, candles: [] }),
    )
    return () => {
      cancelled = true
    }
  }, [id, spark])

  const candles = loaded && loaded.id === id ? loaded.candles : null
  // Quotes tick many times a second; the sparkline and range only need to follow when the price moved.
  return useMemo(() => derive(candles, quote), [candles, quote])
}
