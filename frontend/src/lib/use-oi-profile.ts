import { useEffect, useState } from "react"

import { hub, type TopicMessage } from "@/lib/hub"
import { useHubStatus } from "@/lib/use-hub"

/** One strike's open interest now, and its change since the previous session's settle (NaN where the feed has no figure). */
export interface ProfileRow {
  strike: number
  call: number
  put: number
  callChange: number
  putChange: number
}

interface OiReply {
  at: number
  strikes: number[]
  call: (number | null)[]
  put: (number | null)[]
  call_prev: (number | null)[]
  put_prev: (number | null)[]
}

/** The hub shares one broker answer a minute among everyone, so asking more often gains nothing. */
const REFRESH_MS = 60_000
const RETRY_MS = 3_000

const num = (v: number | null | undefined) => (v === null || v === undefined ? Number.NaN : v)
const kept = new Map<string, { rows: ProfileRow[]; at: number }>()

/**
 * The OI profile of an underlying's expiry: every strike's call and put open interest in one hub
 * request (`oi_profile`), asked again each minute. A failed ask keeps the last profile on screen
 * and tries again soon. Off (`enabled` false) it asks nothing.
 */
export function useOiProfile(underlying: string | undefined, expiry: string | undefined, enabled: boolean) {
  const status = useHubStatus()
  const key = `${underlying}|${expiry}`
  const [state, setState] = useState<{ key: string; rows: ProfileRow[]; at: number } | null>(() => {
    const k = kept.get(key)
    return k ? { key, ...k } : null
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !underlying || !expiry || status !== "open") return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = () => {
      hub.request<OiReply>({ op: "oi_profile", underlying, expiries: [expiry] }, "oi_profile").then(
        (r) => {
          if (cancelled) return
          const rows = r.strikes.map((strike, i): ProfileRow => {
            const call = num(r.call[i])
            const put = num(r.put[i])
            return { strike, call, put, callChange: call - num(r.call_prev[i]), putChange: put - num(r.put_prev[i]) }
          })
          if (rows.length === 0) throw new Error("No open interest for this expiry yet.")
          kept.set(key, { rows, at: r.at })
          setState({ key, rows, at: r.at })
          setError(null)
          timer = setTimeout(ask, REFRESH_MS)
        },
        () => {
          if (cancelled) return
          setError("Open interest unavailable")
          timer = setTimeout(ask, RETRY_MS)
        },
      )
    }
    ask()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, underlying, expiry, status, key])

  const current = state && state.key === key ? state : null
  return { rows: current?.rows ?? null, at: current?.at ?? null, error }
}

/**
 * The forward and the ATM implied vol (percent), from the hub's straddle feed: its last bar's
 * synthetic future and IV. Delta needs both, and one subscription gives them where pricing every
 * leg would take two topics a strike. Quiet unless `enabled`.
 */
export function useForwardIv(underlying: string | undefined, expiry: string | undefined, enabled: boolean) {
  const [value, setValue] = useState<{ forward: number; iv: number } | null>(null)

  useEffect(() => {
    setValue(null)
    if (!enabled || !underlying || !expiry) return
    let latest: { forward: number; iv: number } | null = null
    const read = (b: { synth?: number; iv?: number | null } | undefined) => {
      if (b && typeof b.synth === "number" && typeof b.iv === "number" && b.iv > 0) latest = { forward: b.synth, iv: b.iv }
    }
    const off = hub.listen(`straddle:${underlying}:${expiry}`, (msg: TopicMessage) => {
      if (msg.t === "straddle_snapshot") read((msg.bars as { synth?: number; iv?: number | null }[]).filter((b) => typeof b.iv === "number").at(-1))
      else if (msg.t === "straddle") read(msg.bar as { synth?: number; iv?: number | null })
    })
    // A bar a second would redraw the profile a second; it follows the market every few seconds instead.
    const beat = setInterval(() => latest && setValue((v) => (v && v.forward === latest!.forward && v.iv === latest!.iv ? v : latest)), 4_000)
    const first = setTimeout(() => latest && setValue(latest), 600)
    return () => {
      off()
      clearInterval(beat)
      clearTimeout(first)
    }
  }, [underlying, expiry, enabled])

  return value
}
