import { useSyncExternalStore } from "react"

/**
 * Three screens, so a hash router is all the page needs: plain links, back and forward work,
 * and the server serves one file.
 *
 *   #/markets
 *   #/charts                            (the layout as the viewer left it)
 *   #/charts/nse:nifty/2026-11-03       (every container pointed at that instrument and expiry)
 *   #/chain/nse:nifty/2026-11-03
 */

export type Route =
  | { name: "markets" }
  | { name: "chain"; underlying?: string; expiry?: string }
  | { name: "charts"; underlying?: string; expiry?: string }

export function parseRoute(hash: string): Route {
  const [, name, underlying, a, b] = hash.replace(/^#/, "").split("/")
  const id = underlying && underlying !== "_" ? decodeURIComponent(underlying) : undefined
  if (name === "chain") return { name: "chain", underlying: id, expiry: a }
  if (name === "charts") {
    // An older link carried a view between the instrument and the expiry: the date is what counts.
    const expiry = [a, b].find((part) => part !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(part))
    return { name: "charts", underlying: id, expiry }
  }
  return { name: "markets" }
}

export const hrefOf = {
  markets: () => "#/markets",
  chain: (underlying?: string, expiry?: string) => (underlying ? `#/chain/${encodeURIComponent(underlying)}${expiry ? `/${expiry}` : ""}` : "#/chain"),
  /** No underlying: the containers keep the instruments they have. */
  charts: (underlying?: string, expiry?: string) => (underlying ? `#/charts/${encodeURIComponent(underlying)}${expiry ? `/${expiry}` : ""}` : "#/charts"),
}

export function navigate(href: string): void {
  location.hash = href
}

// The parsed route is cached per hash so the snapshot is stable between renders.
let cachedHash = ""
let cachedRoute: Route = parseRoute("")

function snapshot(): Route {
  if (location.hash !== cachedHash) {
    cachedHash = location.hash
    cachedRoute = parseRoute(cachedHash)
  }
  return cachedRoute
}

function subscribe(fn: () => void): () => void {
  window.addEventListener("hashchange", fn)
  return () => window.removeEventListener("hashchange", fn)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot)
}
