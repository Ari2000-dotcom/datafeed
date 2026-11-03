import { Move } from "@/components/app/move"
import { RangeBar } from "@/components/app/range-bar"
import { Sparkline } from "@/components/app/sparkline"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt2 } from "@/lib/format"
import { hrefOf } from "@/lib/router"
import type { FeaturedIndex } from "@/lib/instruments"
import { useDay } from "@/lib/use-day"
import { useTickFlash } from "@/lib/use-tick-flash"

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="type-meta">{label}</span>
      <span className="num text-xs text-soft">{value !== null ? fmt2(value) : "-"}</span>
    </div>
  )
}

/** One index: price, move, the session's line, where it sits in the day's range. Opens its chart. */
export function IndexCard({ index }: { index: FeaturedIndex }) {
  const day = useDay(index.id)
  const { quote } = day
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)

  return (
    <a
      href={hrefOf.charts(index.id)}
      title={`${index.name}: open the chart`}
      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-soft">{index.label}</span>
        <span className="type-meta">{index.exchange}</span>
      </div>

      <div className="-mt-1 flex items-baseline gap-2.5">
        {quote ? (
          <>
            <span ref={flash} className="type-display rounded-sm">
              {fmt2(quote.ltp)}
            </span>
            <Move change={day.change} pct={day.pct} abs className="text-[13px]" />
          </>
        ) : (
          <Skeleton className="h-7 w-40" />
        )}
      </div>

      {!day.ready ? (
        <Skeleton className="h-10 w-full" />
      ) : day.spark.length > 1 ? (
        <Sparkline points={day.spark} reference={day.prevClose} />
      ) : (
        // History came back empty (the broker serves none for India VIX): say so, rather than a block that never fills.
        <div className="type-meta flex h-10 items-center">No intraday history</div>
      )}

      <div className="flex flex-col gap-1.5">
        <RangeBar low={day.low} high={day.high} value={quote?.ltp} />
        <div className="flex items-baseline justify-between">
          <Stat label="Low" value={day.low} />
          <Stat label="High" value={day.high} />
        </div>
        <div className="flex items-baseline justify-between">
          <Stat label="Open" value={day.open} />
          <Stat label="Prev close" value={day.prevClose} />
        </div>
      </div>
    </a>
  )
}
