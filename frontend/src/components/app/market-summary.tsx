import { useEffect, useState } from "react"

import { Move } from "@/components/app/move"
import { SessionChart } from "@/components/app/session-chart"
import { Sparkline } from "@/components/app/sparkline"
import { ChevronRightIcon } from "@/components/icons"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt2, toneOf, type Tone } from "@/lib/format"
import { FEATURED, instrumentName } from "@/lib/instruments"
import { hrefOf, navigate } from "@/lib/router"
import { useDay, type DayView } from "@/lib/use-day"
import { useReference, type Underlying } from "@/lib/use-hub"
import { useTickFlash } from "@/lib/use-tick-flash"
import { useWaited } from "@/lib/use-waited"
import { cn } from "@/lib/utils"

/** Reports a row's move on the day to its section, so the heading can count what is up and down. */
export type OnTone = (id: string, tone: Tone | null) => void

/** One market an overview panel lists: an index quoted on itself, or a commodity quoted on its front future. */
export interface OverviewItem {
  /** The instrument: the chart it opens and the id it reports its move under. */
  id: string
  label: string
  name: string
  /** What the row's second line says, e.g. "NSE" or "MCX futures". */
  venue: string
  /** Set for a commodity: its quote is the nearest future, found through the chain. */
  underlying?: Underlying
}

export const INDIA_ITEMS: readonly OverviewItem[] = FEATURED.map((f) => ({
  id: f.id,
  label: f.label,
  name: f.name,
  venue: f.exchange,
}))

export const commodityItems = (list: readonly Underlying[]): OverviewItem[] =>
  list.map((u) => {
    const name = instrumentName(u.id, u.name)
    return { id: u.id, label: name, name, venue: "Futures", underlying: u }
  })

/** The id whose quote and history stand for an item. Null while a commodity's front future is looked up. */
function useQuoteId(item: OverviewItem): string | null {
  const reference = useReference(item.underlying)
  return item.underlying ? reference : item.id
}

function usePick(
  key: string,
  items: readonly OverviewItem[]
): [OverviewItem | undefined, (id: string) => void] {
  const storeKey = `ah:markets:pick:${key}`
  const [pick, setPick] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storeKey)
    } catch {
      return null
    }
  })
  const choose = (id: string) => {
    setPick(id)
    try {
      localStorage.setItem(storeKey, id)
    } catch {
      // Not remembered; the pick still holds for this visit.
    }
  }
  return [items.find((i) => i.id === pick) ?? items[0], choose]
}

function useToneReport(id: string, day: DayView, onTone: OnTone | undefined) {
  const tone = day.change !== null ? toneOf(day.change) : null
  useEffect(() => onTone?.(id, tone), [id, tone, onTone])
}

/** A price that flashes when it ticks, or a skeleton until the first quote, or a dash once that is overdue. */
function Last({
  day,
  waited,
  className,
}: {
  day: DayView
  waited: boolean
  className?: string
}) {
  const flash = useTickFlash<HTMLSpanElement>(day.quote?.ltp)
  if (day.quote)
    return (
      <span ref={flash} className={cn("rounded-sm num", className)}>
        {fmt2(day.quote.ltp)}
      </span>
    )
  return waited ? (
    <span className={cn("text-subtle", className)}>-</span>
  ) : (
    <Skeleton className="ml-auto h-4 w-16" />
  )
}

function Figure({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="type-meta">{label}</span>
      <span className="truncate num text-[13px] text-soft">
        {value !== null ? fmt2(value) : "-"}
      </span>
    </div>
  )
}

/** The chosen market large: name, price and move, the day's four figures, and its session on the clock. */
function Focus({ item }: { item: OverviewItem }) {
  const quoteId = useQuoteId(item)
  const day = useDay(quoteId)
  const waited = useWaited(10_000)
  const flash = useTickFlash<HTMLSpanElement>(day.quote?.ltp)

  return (
    <div className="flex min-w-0 flex-col gap-4 border-b px-5 pt-5 pb-4">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-medium">
              {item.name}
            </span>
            <span className="shrink-0 type-meta">{item.venue}</span>
          </div>
          <div className="flex min-h-8 flex-wrap items-baseline gap-x-3">
            {day.quote ? (
              <>
                <span
                  ref={flash}
                  className="rounded-sm num text-[26px] leading-8 font-medium tracking-[-0.015em]"
                >
                  {fmt2(day.quote.ltp)}
                </span>
                {day.change !== null ? (
                  <Move
                    change={day.change}
                    pct={day.pct}
                    abs
                    className="text-[14px]"
                  />
                ) : null}
              </>
            ) : waited ? (
              <span className="text-[26px] leading-8 text-subtle">-</span>
            ) : (
              <Skeleton className="h-8 w-48" />
            )}
          </div>
        </div>
        <a
          href={hrefOf.charts(item.id)}
          className="ml-auto flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-[13px] text-soft transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px"
        >
          Open chart
          <ChevronRightIcon size={12} />
        </a>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Figure label="Open" value={day.open} />
        <Figure label="High" value={day.high} />
        <Figure label="Low" value={day.low} />
        <Figure label="Prev close" value={day.prevClose} />
      </div>

      {day.ready ? (
        <SessionChart
          key={item.id}
          id={item.id}
          bars={day.bars}
          last={day.quote?.ltp}
          prevClose={day.prevClose}
        />
      ) : waited ? (
        <SessionChart id={item.id} bars={[]} prevClose={null} />
      ) : (
        <Skeleton className="h-[190px] w-full" />
      )}
    </div>
  )
}

function Row({
  item,
  selected,
  onSelect,
  onTone,
}: {
  item: OverviewItem
  selected: boolean
  onSelect: () => void
  onTone?: OnTone
}) {
  const quoteId = useQuoteId(item)
  const day = useDay(quoteId)
  const waited = useWaited(10_000)
  useToneReport(item.id, day, onTone)

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={() => navigate(hrefOf.charts(item.id))}
      title={`${item.name}. Double-click to open the chart.`}
      className={cn(
        "relative grid h-11 w-full grid-cols-[minmax(0,1fr)_auto_64px] items-center gap-3 border-b px-5 text-left transition-colors outline-none last:border-b-0 focus-visible:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_64px_minmax(92px,auto)_64px]",
        selected ? "bg-muted" : "hover:bg-muted/50"
      )}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-foreground"
        />
      ) : null}
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            "truncate text-[13px]",
            selected ? "text-foreground" : "text-soft"
          )}
        >
          {item.label}
        </span>
        <span className="hidden shrink-0 type-meta sm:inline xl:hidden 2xl:inline">
          {item.venue}
        </span>
      </span>
      {day.spark.length > 1 ? (
        <Sparkline
          points={day.spark}
          reference={day.prevClose}
          className="hidden h-5 sm:block"
        />
      ) : (
        <span className="hidden sm:block" />
      )}
      <span className="text-right">
        <Last
          day={day}
          waited={waited}
          className="text-[13px] text-foreground"
        />
      </span>
      <span className="text-right">
        {day.change !== null ? (
          <Move change={day.change} pct={day.pct} className="text-xs" />
        ) : (
          <span className="type-meta">-</span>
        )}
      </span>
    </button>
  )
}

/**
 * One group of markets as a market-overview widget: the chosen one on top with its session chart, the
 * whole group listed under it. Click a row to bring it up; double-click opens its chart. Up and down
 * keys walk the list. The pick is remembered per panel.
 */
export function OverviewPanel({
  panelKey,
  label,
  items,
  loading = false,
  onTone,
}: {
  panelKey: string
  label: string
  items: readonly OverviewItem[]
  loading?: boolean
  onTone?: OnTone
}) {
  const [focus, setPick] = usePick(panelKey, items)

  const onKey = (e: React.KeyboardEvent) => {
    if (!focus || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return
    e.preventDefault()
    const at = items.findIndex((i) => i.id === focus.id)
    setPick(
      items[
        (at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length
      ]!.id
    )
  }

  return (
    <div className="flex h-full flex-col bg-card">
      {focus && !loading ? (
        <Focus item={focus} />
      ) : (
        <div className="flex flex-col gap-4 border-b p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      )}
      <div className="panel-head grid h-8 grid-cols-[minmax(0,1fr)_auto_64px] items-center gap-3 bg-card px-5 type-meta sm:grid-cols-[minmax(0,1fr)_64px_minmax(92px,auto)_64px]">
        <span>Name</span>
        <span className="hidden text-center sm:inline">Today</span>
        <span className="text-right">Last</span>
        <span className="text-right">Change</span>
      </div>
      <div
        role="listbox"
        aria-label={label}
        onKeyDown={onKey}
        className="flex-1"
      >
        {loading
          ? Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex h-11 items-center gap-3 border-b px-5 last:border-b-0"
              >
                <Skeleton className="h-4 w-24" />
                <Skeleton className="ml-auto h-4 w-20" />
              </div>
            ))
          : items.map((item) => (
              <Row
                key={item.id}
                item={item}
                selected={item.id === focus?.id}
                onSelect={() => setPick(item.id)}
                onTone={onTone}
              />
            ))}
      </div>
    </div>
  )
}
