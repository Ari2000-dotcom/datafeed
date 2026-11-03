import { istDate } from "@/lib/format"

/** One candle, in the shape the chart engine takes: `time` is UTC seconds. */
export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const DAY_MS = 86_400_000
const KEEP_MS = 60_000
/** The hub limits history days per minute and answers 429; its allowance refills within seconds. */
const RETRY_MS = [2_000, 5_000, 10_000, 20_000]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * How many bulk requests run at once. One at a time filled a page of rows in one by one, and a few
 * at a time let one instrument the broker refuses (India VIX: the hub retries it for ~20 s) hold the
 * rest. The hub queues them for its brokers anyway; this only keeps a page from opening forty.
 */
const IN_FLIGHT = 12
let running = 0
const waiting: (() => void)[] = []

/** Runs jobs a few at a time, in the order asked: a page of forty rows must not open forty requests at once. */
export function paced<T>(job: () => Promise<T>): Promise<T> {
  const start = () =>
    job().finally(() => {
      running--
      waiting.shift()?.()
    })
  if (running < IN_FLIGHT) {
    running++
    return start()
  }
  return new Promise<void>((go) =>
    waiting.push(() => {
      running++
      go()
    }),
  ).then(start)
}

async function fetchCandles(id: string, interval: string, from: string, to: string): Promise<Candle[]> {
  const q = new URLSearchParams({ id, interval, from, to })
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`/history?${q}`)
    if (res.status === 429 && attempt < RETRY_MS.length) {
      await sleep(RETRY_MS[attempt]!)
      continue
    }
    if (!res.ok) throw new Error(res.status === 429 ? "History limit reached. Try again in a moment." : `History is unavailable (HTTP ${res.status}).`)
    const body = (await res.json()) as { pieces?: { candles?: number[][] }[] }
    const out: Candle[] = []
    for (const piece of body.pieces ?? []) {
      // A candle is [time (s), open, high, low, close, volume].
      for (const c of piece.candles ?? []) out.push({ time: c[0]!, open: c[1]!, high: c[2]!, low: c[3]!, close: c[4]!, volume: c[5] ?? 0 })
    }
    return out.sort((a, b) => a.time - b.time)
  }
}

const answers = new Map<string, { at: number; candles: Promise<Candle[]> }>()

/**
 * Bulk answers (a page of sparklines and rows) also live in the browser's local storage for five
 * minutes, so a reload or a second tab shows the prices at once instead of queueing at the hub again.
 * The live quote moves the price, change, high and low on top of them, so five minutes old is fine.
 */
const STORE_MS = 5 * 60_000
const STORE_PREFIX = "ah:h:"

function readStored(key: string): Candle[] | null {
  try {
    const raw = localStorage.getItem(`${STORE_PREFIX}${key}`)
    if (!raw) return null
    const { at, rows } = JSON.parse(raw) as { at: number; rows: number[][] }
    if (Date.now() - at > STORE_MS) return null
    return rows.map((r) => ({ time: r[0]!, open: r[1]!, high: r[2]!, low: r[3]!, close: r[4]!, volume: r[5]! }))
  } catch {
    return null
  }
}

/** Drops stored answers past their five minutes, so the store holds one page's worth, not every day's. */
function pruneStored(): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (!k?.startsWith(STORE_PREFIX)) continue
    try {
      const { at } = JSON.parse(localStorage.getItem(k) ?? "{}") as { at?: number }
      if (!at || Date.now() - at > STORE_MS) localStorage.removeItem(k)
    } catch {
      localStorage.removeItem(k)
    }
  }
}

function writeStored(key: string, candles: Candle[]): void {
  try {
    pruneStored()
    localStorage.setItem(`${STORE_PREFIX}${key}`, JSON.stringify({ at: Date.now(), rows: candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]) }))
  } catch {
    // Storage full or blocked: the next load asks the hub.
  }
}

/**
 * `days` calendar days of `interval` candles up to today (IST), kept for a minute so two views of
 * one instrument share a request. `bulk` queues behind the other bulk requests and is kept in
 * local storage for five minutes.
 */
export function getCandles(id: string, interval: string, days: number, bulk = false): Promise<Candle[]> {
  const key = `${id}|${interval}|${days}|${istDate(Date.now())}`
  const kept = answers.get(key)
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.candles
  const from = istDate(Date.now() - days * DAY_MS)
  const to = istDate(Date.now())
  const stored = bulk ? readStored(key) : null
  const candles = stored
    ? Promise.resolve(stored)
    : bulk
      ? paced(() => fetchCandles(id, interval, from, to)).then((c) => (writeStored(key, c), c))
      : fetchCandles(id, interval, from, to)
  answers.set(key, { at: Date.now(), candles })
  candles.catch(() => answers.delete(key))
  return candles
}

/** Candles grouped by IST trading day, oldest first. */
export function bySession(candles: readonly Candle[]): { date: string; candles: Candle[] }[] {
  const out: { date: string; candles: Candle[] }[] = []
  for (const c of candles) {
    const date = istDate(c.time * 1000)
    const last = out[out.length - 1]
    if (last && last.date === date) last.candles.push(c)
    else out.push({ date, candles: [c] })
  }
  return out
}
