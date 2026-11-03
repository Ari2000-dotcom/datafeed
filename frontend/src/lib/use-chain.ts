import { useEffect, useState } from "react"

import { hub } from "@/lib/hub"
import { useHubStatus } from "@/lib/use-hub"

export interface ChainStrike {
  strike: number
  /** Canonical ids of the two legs. */
  call: string
  put: string
}

interface ChainReply {
  reference: string | null
  strikes: ChainStrike[]
}

export type ChainState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; strikes: ChainStrike[] }

/** The strikes an underlying lists for an expiry, ascending, fetched when either changes and again on `retry`. */
export function useChain(underlying: string | undefined, expiry: string | undefined) {
  const status = useHubStatus()
  const [state, setState] = useState<ChainState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!underlying || !expiry || status !== "open") return
    let cancelled = false
    setState({ status: "loading" })
    hub.request<ChainReply>({ op: "chain", underlying, expiry }, "chain").then(
      (r) => {
        if (cancelled) return
        const strikes = [...r.strikes].sort((a, b) => a.strike - b.strike)
        setState(strikes.length > 0 ? { status: "ready", strikes } : { status: "error", message: "The exchange lists no strikes for this expiry." })
      },
      (e: unknown) => !cancelled && setState({ status: "error", message: e instanceof Error ? e.message : "Could not load the chain." }),
    )
    return () => {
      cancelled = true
    }
  }, [underlying, expiry, status, attempt])

  return { state, retry: () => setAttempt((n) => n + 1) }
}

/** The index of the strike nearest `spot`, or null until both are known. */
export function nearestStrike(strikes: readonly ChainStrike[] | null, spot: number | undefined): number | null {
  if (!strikes || strikes.length === 0 || spot === undefined) return null
  let best = 0
  for (let i = 1; i < strikes.length; i++) if (Math.abs(strikes[i]!.strike - spot) < Math.abs(strikes[best]!.strike - spot)) best = i
  return best
}
