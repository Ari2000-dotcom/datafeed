import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

import { hub, type HubStatus, type Quote } from "@/lib/hub"
import { nearestExpiry } from "@/lib/format"
import { paced } from "@/lib/history"

export function useHubStatus(): HubStatus {
  return useSyncExternalStore(hub.onStatus, hub.getStatus)
}

/** The latest quote of an instrument, live. Opens its topic while mounted. */
export function useQuote(id: string | null | undefined): Quote | undefined {
  const subscribe = useCallback(
    (fn: () => void) => (id ? hub.watch(id, fn) : () => undefined),
    [id]
  )
  const snapshot = useCallback(() => (id ? hub.quote(id) : undefined), [id])
  return useSyncExternalStore(subscribe, snapshot)
}

// --- the universe -------------------------------------------------------------

export interface Underlying {
  /** Canonical id, e.g. `nse:nifty`. */
  id: string
  name: string
  expiries: string[]
  lot: number
}

/** Names a hub without the `universe` op can still be asked for, one `search` each. */
const FALLBACK_NAMES = [
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "MIDCPNIFTY",
  "SENSEX",
  "BANKEX",
  "CRUDEOIL",
  "NATURALGAS",
  "GOLD",
  "SILVER",
  "COPPER",
  "ZINC",
]

let universe: Promise<Underlying[]> | null = null

async function searchFallback(): Promise<Underlying[]> {
  const hits = await Promise.all(
    FALLBACK_NAMES.map((q) =>
      hub
        .request<{ results: Underlying[] }>({ op: "search", q }, "search")
        .then(
          (r) => r.results.find((u) => u.name === q) ?? null,
          () => null
        )
    )
  )
  return hits.filter((u): u is Underlying => u !== null)
}

/** Today's instrument list, kept in the browser so the page draws its rows before the socket is even open. */
const UNIVERSE_KEY = "ah:universe"

function storedUniverse(): Underlying[] | null {
  try {
    const raw = localStorage.getItem(UNIVERSE_KEY)
    if (!raw) return null
    const { day, list } = JSON.parse(raw) as { day: string; list: Underlying[] }
    return day === new Date().toDateString() && list.length > 0 ? list : null
  } catch {
    return null
  }
}

function loadUniverse(): Promise<Underlying[]> {
  if (!universe) {
    universe = hub
      .request<{ results: Underlying[] }>({ op: "universe" }, "universe")
      .then((r) => r.results)
      .catch(searchFallback)
      .then((list) =>
        [...list].sort(
          (a, b) =>
            (a.expiries[0] ?? "").localeCompare(b.expiries[0] ?? "") ||
            a.name.localeCompare(b.name)
        )
      )
    universe.then(
      (list) => {
        if (list.length === 0) universe = null
        else
          try {
            localStorage.setItem(
              UNIVERSE_KEY,
              JSON.stringify({ day: new Date().toDateString(), list })
            )
          } catch {
            // Not kept: the next visit waits for the socket.
          }
      },
      () => {
        universe = null
      }
    )
  }
  return universe
}

export interface UniverseState {
  list: Underlying[]
  loading: boolean
  error: string | null
}

/** Every underlying the hub offers, fetched once per page and shared. */
export function useUniverse(): UniverseState {
  const status = useHubStatus()
  const [state, setState] = useState<UniverseState>(() => {
    const list = storedUniverse()
    return { list: list ?? [], loading: !list, error: null }
  })

  useEffect(() => {
    if (status !== "open") return
    let cancelled = false
    loadUniverse().then(
      (list) =>
        !cancelled &&
        setState({
          list,
          loading: false,
          error:
            list.length === 0 ? "No markets are available right now." : null,
        }),
      () =>
        !cancelled &&
        // Today's stored list stays on screen when a refresh fails; only an empty page shows the error.
        setState((s) =>
          s.list.length > 0
            ? { ...s, loading: false }
            : {
                list: [],
                loading: false,
                error: "Markets could not be loaded. Please try again.",
              }
        )
    )
    return () => {
      cancelled = true
    }
  }, [status])

  return state
}

// --- the instrument a chain prices against ----------------------------------------

const references = new Map<string, Promise<string | null>>()

/**
 * A commodity's front future changes only when a contract expires, yet finding it costs a whole chain
 * request. So the answer is kept in the browser for the day, keyed by the option expiry it was asked
 * for: the next visit quotes the future at once instead of queueing a chain per commodity first.
 */
const REF_PREFIX = "ah:ref:"
const refKey = (u: Underlying) =>
  `${REF_PREFIX}${u.id}|${nearestExpiry(u.expiries) ?? ""}|${new Date().toDateString()}`

function storedReference(u: Underlying): string | null {
  try {
    return localStorage.getItem(refKey(u))
  } catch {
    return null
  }
}

function storeReference(u: Underlying, ref: string): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(`${REF_PREFIX}${u.id}|`)) localStorage.removeItem(k)
    }
    localStorage.setItem(refKey(u), ref)
  } catch {
    // Not kept: the next visit asks the hub again.
  }
}

/**
 * The instrument whose price an underlying's options are quoted against: the index itself for
 * NSE and BSE, the nearest futures contract for an MCX commodity (the hub's chain reply names it).
 */
export function useReference(u: Underlying | undefined): string | null {
  const status = useHubStatus()
  const [found, setFound] = useState<{ id: string; ref: string | null } | null>(
    null
  )
  const direct = u && !u.id.startsWith("mcx:") ? u.id : null

  useEffect(() => {
    if (!u || direct || status !== "open" || storedReference(u)) return
    let cancelled = false
    let pending = references.get(u.id)
    if (!pending) {
      const expiry = nearestExpiry(u.expiries)
      pending = expiry
        ? paced(() =>
            hub.request<{ reference: string | null }>(
              { op: "chain", underlying: u.id, expiry },
              "chain"
            )
          ).then((r) => {
            if (r.reference) storeReference(u, r.reference)
            return r.reference
          })
        : Promise.resolve(null)
      references.set(u.id, pending)
      pending.catch(() => references.delete(u.id))
    }
    pending.then(
      (ref) => !cancelled && setFound({ id: u.id, ref }),
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [u, direct, status])

  if (direct) return direct
  if (!u) return null
  return found && found.id === u.id ? found.ref : storedReference(u)
}
