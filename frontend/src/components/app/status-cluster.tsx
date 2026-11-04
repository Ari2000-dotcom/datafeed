import { useState, useSyncExternalStore } from "react"

import { istClock } from "@/lib/format"
import { hub } from "@/lib/hub"
import { sessions, type SessionState } from "@/lib/session"
import { useHubStatus } from "@/lib/use-hub"
import { useNow } from "@/lib/use-now"
import { cn } from "@/lib/utils"

const SESSION_LABEL: Record<SessionState, string> = { open: "Open", pre: "Pre-open", closed: "Closed" }
const SESSION_TEXT: Record<SessionState, string> = { open: "text-foreground", pre: "text-primary", closed: "text-muted-foreground" }

/** Seconds until the hub's next reconnect attempt, live; null when none is scheduled. */
function useRetryIn(): number | null {
  const now = useNow()
  const at = useSyncExternalStore(hub.onStatus, hub.getRetryAt)
  return at === null ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

/**
 * The feed's state: the one dot on the page, because it is a real state and not decoration. Live is a
 * steady green; connecting pulses grey; a dropped feed pulses red, counts down to its next attempt and
 * is a button that tries at once.
 */
export function FeedStatus({ className }: { className?: string }) {
  const status = useHubStatus()
  const retryIn = useRetryIn()

  if (status === "open")
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)} role="status">
        <span className="size-1.5 rounded-full bg-up" aria-hidden />
        <span>Live</span>
      </span>
    )

  const dropped = status === "reconnecting"
  return (
    <button
      type="button"
      onClick={hub.retryNow}
      title={dropped ? "The connection to the feed dropped. Click to try again now." : "Connecting to the feed"}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
        dropped ? "text-down" : "text-muted-foreground",
        className
      )}
    >
      <span className="relative flex size-1.5" aria-hidden>
        <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", dropped ? "bg-down" : "bg-muted-foreground")} />
        <span className={cn("relative size-1.5 rounded-full", dropped ? "bg-down" : "bg-muted-foreground")} />
      </span>
      <span aria-live="polite">{dropped ? (retryIn ? `Reconnecting in ${retryIn}s` : "Reconnecting") : "Connecting"}</span>
    </button>
  )
}

/**
 * Said once, under the nav bar, when the feed has been down a few seconds: what the prices on screen
 * are now, and a way to try again. A blip shorter than that shows only in the status dot.
 */
export function FeedNotice() {
  const status = useHubStatus()
  const now = useNow()
  const [since, setSince] = useState<number | null>(null)
  const retryIn = useRetryIn()
  if (status === "reconnecting" && since === null) setSince(now)
  if (status !== "reconnecting" && since !== null) setSince(null)
  if (since === null || now - since < 5_000) return null

  return (
    <div role="alert" className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-down/30 bg-down/10 px-6 py-1.5 text-[13px]">
      <span className="text-foreground">Live prices are paused.</span>
      <span className="text-muted-foreground">The figures on screen are the last ones received.</span>
      <span className="ml-auto num text-xs text-muted-foreground">{retryIn ? `Trying again in ${retryIn}s` : "Trying again"}</span>
      <button type="button" onClick={hub.retryNow} className="h-7 rounded-md px-2.5 text-xs font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px">
        Retry now
      </button>
    </div>
  )
}

/** Clock in IST, each exchange's session, and the feed. */
export function StatusCluster() {
  const now = useNow()
  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="num whitespace-nowrap text-muted-foreground" title="India Standard Time">
        {istClock(now)} <span className="font-sans">IST</span>
      </span>
      {sessions(now).map((s) => (
        <span key={s.exchange} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="text-subtle">{s.exchange}</span>
          <span className={cn("font-medium", SESSION_TEXT[s.state])}>{SESSION_LABEL[s.state]}</span>
        </span>
      ))}
      <FeedStatus />
    </div>
  )
}
