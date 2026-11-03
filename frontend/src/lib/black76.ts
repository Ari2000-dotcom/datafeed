/**
 * Black-76 on a forward, undiscounted (rates do not move an option on a future enough to matter at
 * this scale, and the hub prices the same way). Enough for a leg's implied vol and its delta.
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI)

/** The standard normal's cumulative distribution (Zelen and Severo, error under 8e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = Math.exp((-x * x) / 2) / SQRT_2PI
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}

function d1(f: number, k: number, t: number, sigma: number): number {
  return (Math.log(f / k) + 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t))
}

export function price76(f: number, k: number, t: number, sigma: number, call: boolean): number {
  const sd = sigma * Math.sqrt(t)
  const a = d1(f, k, t, sigma)
  const b = a - sd
  return call ? f * normCdf(a) - k * normCdf(b) : k * normCdf(-b) - f * normCdf(-a)
}

/** A call's delta is N(d1); a put's is N(d1) - 1. */
export function delta76(f: number, k: number, t: number, sigma: number, call: boolean): number {
  const n = normCdf(d1(f, k, t, sigma))
  return call ? n : n - 1
}

/**
 * The vol that prices the leg at `price`, by bisection. Null when none does: a price at or under
 * intrinsic value, or above anything a vol of 500% could ask for.
 */
export function impliedVol(price: number, f: number, k: number, t: number, call: boolean): number | null {
  if (!(price > 0) || !(f > 0) || !(k > 0) || !(t > 0)) return null
  const intrinsic = Math.max(0, call ? f - k : k - f)
  if (price <= intrinsic + 1e-9) return null
  let lo = 0.001
  let hi = 5
  if (price76(f, k, t, hi, call) < price) return null
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    if (price76(f, k, t, mid, call) < price) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const YEAR_MS = 365 * 86_400_000

/** Years from `now` to the expiry's close (15:30 IST, 23:30 for MCX), never under a minute. */
export function yearsToExpiry(expiry: string, mcx: boolean, now = Date.now()): number {
  const close = Date.parse(`${expiry}T${mcx ? "23:30" : "15:30"}:00+05:30`)
  return Math.max(close - now, 60_000) / YEAR_MS
}
