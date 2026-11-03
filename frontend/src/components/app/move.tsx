import { signed, signedPct, toneOf, type Tone } from "@/lib/format"
import { cn } from "@/lib/utils"

export const TONE_TEXT: Record<Tone, string> = {
  up: "text-up",
  down: "text-down",
  flat: "text-muted-foreground",
}

/**
 * A move on the day, e.g. "+0.52%". Colour is never the only signal: the sign says the same
 * thing. `abs` puts the points change in front, in `absClassName` (a container query can hide it).
 */
export function Move({ change, pct, abs = false, absClassName, className }: { change: number | null; pct: number | null; abs?: boolean; absClassName?: string; className?: string }) {
  if (change === null || pct === null) return <span className={cn("num text-muted-foreground", className)}>-</span>
  return (
    <span className={cn("num inline-flex items-center gap-2 whitespace-nowrap", TONE_TEXT[toneOf(pct)], className)}>
      {abs ? <span className={absClassName}>{signed(change)}</span> : null}
      <span>{signedPct(pct)}</span>
    </span>
  )
}
