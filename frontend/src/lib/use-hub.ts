import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

import { hub, type HubStatus, type Quote } from "@/lib/hub"
import { nearestExpiry } from "@/lib/format"
import { paced } from "@/lib/history"

export function useHubStatus(): HubStatus {
  return useSyncExternalStore(hub.onStatus, hub.getStatus)
}

/** The latest quote of an instrument, live. Opens its topic while mounted. */
export function useQuote(id: string | null | undefined): Quote | undefined {
  const subscribe = useCallback((fn: () => void) => (id ? hub.watch(id, fn) : () => undefined), [id])
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
const FALLBACK_NAMES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "CRUDEOIL", "NATURALGAS", "GOLD", "SILVER", "COPPER", "ZINC"]

let universe: Promise<Underlying[]> | null = null

async function searchFallback(): Promise<Underlying[]> {
  const hits = await Promise.all(
    FALLBACK_NAMES.map((q) =>
      hub.request<{ results: Underlying[] }>({ op: "search", q }, "search").then(
        (r) => r.results.find((u) => u.name === q) ?? null,
        () => null,
      ),
    ),
  )
  return hits.filter((u): u is Underlying => u !== null)
}

function loadUniverse(): Promise<Underlying[]> {
  if (!universe) {
    universe = hub
      .request<{ results: Underlying[] }>({ op: "universe" }, "universe")
      .then((r) => r.results)
      .catch(searchFallback)
      .then((list) => [...list].sort((a, b) => (a.expiries[0] ?? "").localeCompare(b.expiries[0] ?? "") || a.name.localeCompare(b.name)))
    universe.then(
      (list) => {
        if (list.length === 0) universe = null
      },
      () => {
        universe = null
      },
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
  const [state, setState] = useState<UniverseState>({ list: [], loading: true, error: null })

  useEffect(() => {
    if (status !== "open") return
    let cancelled = false
    loadUniverse().then(
      (list) => !cancelled && setState({ list, loading: false, error: list.length === 0 ? "The feed has no instruments to list." : null }),
      (e: unknown) => !cancelled && setState({ list: [], loading: false, error: e instanceof Error ? e.message : "Could not load instruments." }),
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
 * The instrument whose price an underlying's options are quoted against: the index itself for
 * NSE and BSE, the nearest futures contract for an MCX commodity (the hub's chain reply names it).
 */
export function useReference(u: Underlying | undefined): string | null {
  const status = useHubStatus()
  const [found, setFound] = useState<{ id: string; ref: string | null } | null>(null)
  const direct = u && !u.id.startsWith("mcx:") ? u.id : null

  useEffect(() => {
    if (!u || direct || status !== "open") return
    let cancelled = false
    let pending = references.get(u.id)
    if (!pending) {
      const expiry = nearestExpiry(u.expiries)
      pending = expiry
        ? paced(() => hub.request<{ reference: string | null }>({ op: "chain", underlying: u.id, expiry }, "chain")).then((r) => r.reference)
        : Promise.resolve(null)
      references.set(u.id, pending)
      pending.catch(() => references.delete(u.id))
    }
    pending.then(
      (ref) => !cancelled && setFound({ id: u.id, ref }),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [u, direct, status])

  if (direct) return direct
  return u && found && found.id === u.id ? found.ref : null
}
