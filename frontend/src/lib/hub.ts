/**
 * The page's one WebSocket to the hub (api.rs documents the protocol).
 *
 * - Topics are reference counted: a quote opened by three components is one `sub`.
 * - A topic nobody watches any more stays subscribed for LINGER_MS, so switching pages and
 *   coming back (or React remounting in development) costs the hub nothing and the last
 *   quote is still there to show.
 * - Reconnects by itself with exponential backoff and full jitter, then re-subscribes.
 * - Quote updates reach React once per animation frame, newest value per instrument.
 */

export type HubStatus = "connecting" | "open" | "reconnecting"

export interface Quote {
  ltp: number
  v: number | null
  bid?: number
  ask?: number
  /** Open interest and yesterday's, for a derivative leg. */
  oi?: number
  poi?: number
  atp?: number
  ts: number
  /** The broker's last known state, not a live tick. */
  replay?: boolean
}

/** A message of a non-quote topic, as the hub sends it. */
export interface TopicMessage {
  t: string
  topic?: string
  [key: string]: unknown
}

interface Pending {
  resolve: (v: never) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  want: string
}

const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const LINGER_MS = 3_000
const QUOTE_PREFIX = "quote:"

export function hubUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${location.host}/ws`
}

export class Hub {
  private ws: WebSocket | null = null
  private status: HubStatus = "connecting"
  private attempt = 0
  private nextReq = 1
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private readonly statusListeners = new Set<() => void>()
  private readonly pending = new Map<string, Pending>()

  private readonly quotes = new Map<string, Quote>()
  private readonly watchers = new Map<string, Set<() => void>>()
  private readonly lingering = new Map<string, ReturnType<typeof setTimeout>>()
  /** Listeners of whole-topic feeds such as a straddle's session. */
  private readonly feeds = new Map<string, Set<(msg: TopicMessage) => void>>()
  /** Every instrument the hub has been asked for and not told to drop. */
  private readonly active = new Set<string>()
  private subQ = new Set<string>()
  private unsubQ = new Set<string>()
  private flushQueued = false
  private dirty = new Set<string>()
  private frame = 0

  private readonly url: string

  constructor(url: string) {
    this.url = url
    this.open()
  }

  // --- status -------------------------------------------------------------

  getStatus = (): HubStatus => this.status

  onStatus = (fn: () => void): (() => void) => {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  // --- quotes -------------------------------------------------------------

  quote = (id: string): Quote | undefined => this.quotes.get(id)

  /** Calls `fn` whenever `id` has a new quote, until the returned function is called. */
  watch(id: string, fn: () => void): () => void {
    let set = this.watchers.get(id)
    if (!set) {
      set = new Set()
      this.watchers.set(id, set)
    }
    set.add(fn)

    const lingering = this.lingering.get(id)
    if (lingering !== undefined) {
      clearTimeout(lingering)
      this.lingering.delete(id)
    } else if (!this.active.has(id)) {
      this.active.add(id)
      this.queue("sub", id)
    }

    return () => {
      const current = this.watchers.get(id)
      if (!current) return
      current.delete(fn)
      if (current.size > 0) return
      this.watchers.delete(id)
      this.lingering.set(
        id,
        setTimeout(() => {
          this.lingering.delete(id)
          this.active.delete(id)
          this.quotes.delete(id)
          this.queue("unsub", id)
        }, LINGER_MS),
      )
    }
  }

  /**
   * Messages of a topic that is not a quote (`straddle:nse:nifty:2026-11-03`) go to `fn` until the
   * returned function is called. The hub sends such a topic's state (a session so far) only on a
   * fresh `sub`, so a listener joining a topic already held makes the hub send it again.
   */
  listen(topic: string, fn: (msg: TopicMessage) => void): () => void {
    let set = this.feeds.get(topic)
    if (!set) {
      set = new Set()
      this.feeds.set(topic, set)
      this.send({ op: "sub", topics: [topic] })
    } else {
      this.send({ op: "unsub", topics: [topic] })
      this.send({ op: "sub", topics: [topic] })
    }
    set.add(fn)
    return () => {
      const current = this.feeds.get(topic)
      if (!current) return
      current.delete(fn)
      if (current.size > 0) return
      this.feeds.delete(topic)
      this.send({ op: "unsub", topics: [topic] })
    }
  }

  // --- requests -----------------------------------------------------------

  /** Sends `op` with a fresh `req` id and resolves with the reply of type `want`. */
  request<T>(op: Record<string, unknown>, want: string, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.status !== "open") {
        reject(new Error("Not connected to the feed yet."))
        return
      }
      const req = `r${this.nextReq++}`
      const timer = setTimeout(() => {
        this.pending.delete(req)
        reject(new Error("The feed did not answer in time."))
      }, timeoutMs)
      this.pending.set(req, { resolve: resolve as (v: never) => void, reject, timer, want })
      this.send({ ...op, req })
    })
  }

  // --- socket -------------------------------------------------------------

  private open(): void {
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting")
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onopen = () => {
      this.attempt = 0
      this.setStatus("open")
      const topics = [...[...this.active].map((id) => QUOTE_PREFIX + id), ...this.feeds.keys()]
      if (topics.length > 0) this.send({ op: "sub", topics })
    }
    ws.onmessage = (event) => this.receive(String(event.data))
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      for (const [req, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new Error("Lost the connection to the feed. Try again."))
        this.pending.delete(req)
      }
      // Full jitter: after a hub restart the tabs come back spread over the ceiling, not in one second.
      const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.attempt)
      this.attempt += 1
      this.setStatus("reconnecting")
      this.retryTimer = setTimeout(() => this.open(), 250 + Math.random() * ceiling)
    }
  }

  private receive(data: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }

    const req = msg.req
    if (typeof req === "string") {
      const p = this.pending.get(req)
      if (p && (msg.t === p.want || msg.t === "err")) {
        clearTimeout(p.timer)
        this.pending.delete(req)
        if (msg.t === "err") p.reject(new Error(String(msg.error ?? "The feed refused the request.")))
        else p.resolve(msg as never)
        return
      }
    }

    const topic = msg.topic
    if (msg.t === "q" && typeof topic === "string" && topic.startsWith(QUOTE_PREFIX) && typeof msg.ltp === "number") {
      const id = topic.slice(QUOTE_PREFIX.length)
      this.quotes.set(id, {
        ltp: msg.ltp,
        v: typeof msg.v === "number" ? msg.v : null,
        bid: typeof msg.bid === "number" ? msg.bid : undefined,
        ask: typeof msg.ask === "number" ? msg.ask : undefined,
        oi: typeof msg.oi === "number" ? msg.oi : undefined,
        poi: typeof msg.poi === "number" ? msg.poi : undefined,
        atp: typeof msg.atp === "number" ? msg.atp : undefined,
        ts: typeof msg.ts === "number" ? msg.ts : Date.now(),
        replay: msg.replay === true ? true : undefined,
      })
      this.dirty.add(id)
      if (!this.frame) this.frame = requestAnimationFrame(this.flushDirty)
    } else if (typeof topic === "string") {
      for (const fn of this.feeds.get(topic) ?? []) fn(msg as TopicMessage)
    }
  }

  private flushDirty = (): void => {
    this.frame = 0
    const ids = this.dirty
    this.dirty = new Set()
    for (const id of ids) for (const fn of this.watchers.get(id) ?? []) fn()
  }

  /** One `sub` and one `unsub` per tick: a chain opens dozens of quotes at once. */
  private queue(kind: "sub" | "unsub", id: string): void {
    if (kind === "sub") {
      this.unsubQ.delete(id)
      this.subQ.add(id)
    } else if (!this.subQ.delete(id)) {
      this.unsubQ.add(id)
    }
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => {
      this.flushQueued = false
      if (this.unsubQ.size > 0) this.send({ op: "unsub", topics: [...this.unsubQ].map((id) => QUOTE_PREFIX + id) })
      if (this.subQ.size > 0) this.send({ op: "sub", topics: [...this.subQ].map((id) => QUOTE_PREFIX + id) })
      this.unsubQ = new Set()
      this.subQ = new Set()
    })
  }

  private send(op: Record<string, unknown>): void {
    // Not open: subscriptions are replayed on connect, requests are refused above.
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(op))
  }

  private setStatus(next: HubStatus): void {
    if (next === this.status) return
    this.status = next
    for (const fn of this.statusListeners) fn()
  }

  dispose(): void {
    clearTimeout(this.retryTimer)
    const ws = this.ws
    this.ws = null
    ws?.close()
  }
}

/** One per tab, for the life of the page. */
export const hub = new Hub(hubUrl())
