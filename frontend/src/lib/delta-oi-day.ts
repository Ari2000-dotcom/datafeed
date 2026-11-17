import { useEffect, useState } from "react"

import { delta76, yearsToExpiry } from "@/lib/black76"
import { istDate } from "@/lib/format"
import { hub, type TopicMessage } from "@/lib/hub"
import { useHubStatus } from "@/lib/use-hub"

/**
 * The Delta × OI board's day line from history: the latest session's open interest every five
 * minutes (the hub's `oi_series`, from Nubra), each instant's forward and ATM implied vol from the
 * straddle's minute bars, and Black-76 deltas from those. One vol for every strike (the ATM's) is
 * a simplification the live board does not make: it reads each leg's own vol, so the live total and
 * the line's last point can differ a little on a steep skew.
 */

export interface DayPoint {
  /** Instant, ms. */
  t: number
  call: number
  put: number
}

export interface SeriesReply {
  day: string
  at: number[]
  strikes: number[]
  call: (number | null)[][]
  put: (number | null)[][]
}

interface Bar {
  t: number
  spot: number
  synth: number
  iv: number | null
}

const STEP_MIN = 5
const REFRESH_MS = 5 * 60_000

/** The day's straddle bars: today's from the live topic's first snapshot, a past day's by request. */
function straddleBars(underlying: string, expiry: string, day: string): Promise<Bar[]> {
  if (day !== istDate(Date.now())) {
    return hub
      .request<{ bars: Bar[] }>({ op: "straddle_history", underlying, expiry, date: day }, "straddle_history")
      .then((r) => r.bars)
  }
  return new Promise((resolve) => {
    let stop: (() => void) | null = null
    const timer = setTimeout(() => {
      stop?.()
      resolve([])
    }, 20_000)
    stop = hub.listen(`straddle:${underlying}:${expiry}`, (msg: TopicMessage) => {
      if (msg.t !== "straddle_snapshot") return
      const bars = (msg.bars as Bar[] | undefined) ?? []
      // Still building today's session: wait for the snapshot the hub sends when it lands.
      if (bars.length === 0 && String(msg.backfill ?? "") === "loading") return
      clearTimeout(timer)
      stop?.()
      resolve(bars)
    })
  })
}

/** The last bar at or before `t`: the forward and vol the market had at that instant. */
function barAt(bars: readonly Bar[], t: number): Bar | null {
  let found: Bar | null = null
  for (const b of bars) {
    if (b.t > t) break
    found = b
  }
  return found ?? bars[0] ?? null
}

export function dayPoints(series: SeriesReply, bars: readonly Bar[], expiry: string, mcx: boolean, multiplier: number): DayPoint[] {
  const sorted = [...bars].sort((a, b) => a.t - b.t)
  return series.at.flatMap((t, i): DayPoint[] => {
    const bar = barAt(sorted, t)
    const forward = bar ? bar.synth || bar.spot : null
    const sigma = bar?.iv != null ? bar.iv / 100 : null
    if (!forward || !sigma) return []
    const years = yearsToExpiry(expiry, mcx, t)
    let call = 0
    let put = 0
    let counted = 0
    series.strikes.forEach((k, j) => {
      const c = series.call[i]?.[j]
      const p = series.put[i]?.[j]
      if (c != null) call += delta76(forward, k, years, sigma, true) * c * multiplier
      if (p != null) put += delta76(forward, k, years, sigma, false) * p * multiplier
      if (c != null || p != null) counted++
    })
    // An instant Nubra had nothing for is a gap, not a zero.
    return counted > 0 ? [{ t, call, put }] : []
  })
}

export type DayHistory =
  | { kind: "loading" }
  | { kind: "ready"; day: string; points: DayPoint[] }
  /** The hub could not give the day (an older hub without `oi_series`, or Nubra busy): the board records its own line instead. */
  | { kind: "unavailable" }

/**
 * The day's call and put delta × OI from the open, refreshed every five minutes. `forward` only picks
 * which strikes to read (the band around it), so it is rounded to keep the request stable as it drifts.
 */
export function useDayHistory(underlying: string, expiry: string | undefined, band: number, forward: number | null, multiplier: number): DayHistory {
  const status = useHubStatus()
  const [state, setState] = useState<{ key: string; value: DayHistory }>({ key: "", value: { kind: "loading" } })
  const centre = forward !== null ? Math.round(forward) : null
  const key = `${underlying}|${expiry}|${band}|${multiplier}`

  useEffect(() => {
    if (!expiry || centre === null || status !== "open") return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const mcx = underlying.startsWith("mcx:")
    const load = async () => {
      try {
        const series = await hub.request<SeriesReply>({ op: "oi_series", underlying, expiry, band, forward: centre, step: STEP_MIN }, "oi_series", 45_000)
        const bars = await straddleBars(underlying, expiry, series.day)
        if (cancelled) return
        setState({ key, value: { kind: "ready", day: series.day, points: dayPoints(series, bars, expiry, mcx, multiplier) } })
      } catch {
        if (!cancelled) setState((s) => (s.key === key && s.value.kind === "ready" ? s : { key, value: { kind: "unavailable" } }))
      }
      if (!cancelled) timer = setTimeout(load, REFRESH_MS)
    }
    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // The centre is read when the request is made; a drifting forward should not re-ask every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, status, centre === null])

  return state.key === key ? state.value : { kind: "loading" }
}
