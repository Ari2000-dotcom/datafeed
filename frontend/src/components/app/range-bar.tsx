import { cn } from "@/lib/utils"

/** Where a price sits between the day's low and high: a 4 px rule with a marker, as a broker's "day range". */
export function RangeBar({ low, high, value, className }: { low: number | null; high: number | null; value: number | undefined; className?: string }) {
  const known = low !== null && high !== null && value !== undefined && high > low
  const at = known ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100)) : null
  return (
    <div className={cn("relative h-1 w-full rounded-full bg-muted", className)} role="img" aria-label={known ? `Day range ${low} to ${high}, now ${value}` : "Day range not available yet"}>
      {at !== null ? <span className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${at}%` }} /> : null}
    </div>
  )
}
