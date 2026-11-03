import { istClock } from "@/lib/format"
import type { HubStatus } from "@/lib/hub"
import { sessions, type SessionState } from "@/lib/session"
import { useHubStatus } from "@/lib/use-hub"
import { useNow } from "@/lib/use-now"
import { cn } from "@/lib/utils"

const SESSION_LABEL: Record<SessionState, string> = { open: "Open", pre: "Pre-open", closed: "Closed" }
const SESSION_TEXT: Record<SessionState, string> = { open: "text-foreground", pre: "text-primary", closed: "text-muted-foreground" }

const FEED: Record<HubStatus, { label: string; dot: string }> = {
  open: { label: "Live", dot: "bg-up" },
  connecting: { label: "Connecting", dot: "bg-primary" },
  reconnecting: { label: "Reconnecting", dot: "bg-destructive" },
}

/** The feed's state: the one dot on the page, because it is a real state and not decoration. */
export function FeedStatus({ className }: { className?: string }) {
  const feed = FEED[useHubStatus()]
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)} role="status">
      <span className={cn("size-1.5", feed.dot)} aria-hidden />
      <span>{feed.label}</span>
    </span>
  )
}

/** Clock in IST, each exchange's session, and the feed. */
export function StatusCluster() {
  const now = useNow()
  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="num text-muted-foreground" title="India Standard Time">
        {istClock(now)} <span className="font-sans">IST</span>
      </span>
      {sessions(now).map((s) => (
        <span key={s.exchange} className="flex items-center gap-1.5">
          <span className="text-subtle">{s.exchange}</span>
          <span className={cn("font-medium", SESSION_TEXT[s.state])}>{SESSION_LABEL[s.state]}</span>
        </span>
      ))}
      <FeedStatus />
    </div>
  )
}
