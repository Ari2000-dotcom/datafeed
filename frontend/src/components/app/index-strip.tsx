import { useLayoutEffect, useMemo, useRef, useState } from "react"

import { ChevronUpIcon } from "@/components/icons"
import { TONE_TEXT } from "@/components/app/move"
import { Tip, ToolButton } from "@/components/app/toolbar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  expiryLabel,
  fmt2,
  nearestExpiry,
  signed,
  signedPct,
  toneOf,
} from "@/lib/format"
import { FEATURED, type FeaturedIndex } from "@/lib/instruments"
import { hrefOf } from "@/lib/router"
import { useDay } from "@/lib/use-day"
import { useUniverse } from "@/lib/use-hub"
import { useTickFlash } from "@/lib/use-tick-flash"
import { cn } from "@/lib/utils"

/** India VIX stands pinned at the strip's right end. */
const VIX_ID = "nse:indiavix"
const VIX = FEATURED.find((i) => i.id === VIX_ID)
const ITEMS = FEATURED.filter((i) => i.strip && i.id !== VIX_ID)

/**
 * How tightly the strip sets its cells, so every index fits and none is put away in a menu. Each step
 * gives up the least useful piece first:
 *   0  name, price, points and percent, expiry
 *   1  the expiry goes (it stays in the cell's tooltip)
 *   2  the move as a percent only
 *   3  closer cells
 * Measured, never guessed from the window width: the step is the loosest one the row fits at.
 */
type Density = 0 | 1 | 2 | 3
const TIGHTEST: Density = 3

/** "+387.70 (+1.68%)", or "+1.68%" when the strip is tight: in the move's colour, as a broker's strip sets it. */
function Change({
  change,
  pct,
  short,
}: {
  change: number | null
  pct: number | null
  short: boolean
}) {
  if (change === null || pct === null)
    return <span className="num text-muted-foreground">-</span>
  return (
    <span className={cn("num", TONE_TEXT[toneOf(pct)])}>
      {short ? signedPct(pct) : `${signed(change)} (${signedPct(pct)})`}
    </span>
  )
}

const cellClass = (density: Density) =>
  cn(
    "flex h-8 items-center text-[13px] whitespace-nowrap outline-none",
    density >= 3 ? "gap-1.5 px-2" : "gap-2 px-3"
  )

/**
 * One index in the strip, as a broker's ticker sets it: the name a step quieter than the price, the
 * price, the move in its colour, and the nearest options expiry last and smallest. A hairline at the
 * start of each cell after the first keeps the figures of two indices from reading as one run.
 */
function Cell({
  item,
  expiry,
  first,
  density,
}: {
  item: FeaturedIndex
  expiry: string | undefined
  first: boolean
  density: Density
}) {
  const { quote, pct, change } = useDay(item.id)
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)
  const body = (
    <>
      <span className="text-muted-foreground">{item.label}</span>
      {quote ? (
        <>
          <span
            ref={flash}
            className="rounded-sm num font-medium text-foreground"
          >
            {fmt2(quote.ltp)}
          </span>
          <Change change={change} pct={pct} short={density >= 2} />
        </>
      ) : (
        <>
          <Skeleton className="h-3 w-[8ch]" />
          <Skeleton className="h-3 w-[7ch]" />
        </>
      )}
      {expiry && density < 1 ? (
        <span className="num text-[11px] text-subtle">
          {expiryLabel(expiry)}
        </span>
      ) : null}
    </>
  )
  const title = `${item.name}${expiry ? `, options expire ${expiryLabel(expiry)}` : ""}`
  return (
    <div className="flex shrink-0 items-center">
      {first ? null : <span className="h-4 w-px bg-border" aria-hidden />}
      {item.options ? (
        <a
          href={hrefOf.charts(item.id)}
          title={`${title}. Open the chart.`}
          className={cn(
            cellClass(density),
            "transition-colors duration-150 hover:bg-accent/70 focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          )}
        >
          {body}
        </a>
      ) : (
        <div className={cellClass(density)} title={title}>
          {body}
        </div>
      )}
    </div>
  )
}

/**
 * India VIX, pinned: the level, its move on the day, and a short read of where it sits (calm under 12,
 * normal to 20, high above), so the market's fear gauge is always one glance away.
 */
function VixCell({ item, density }: { item: FeaturedIndex; density: Density }) {
  const { quote, pct, change } = useDay(item.id)
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)
  const level = quote?.ltp
  const read =
    level === undefined
      ? null
      : level < 12
        ? "Calm"
        : level <= 20
          ? "Normal"
          : "High"
  return (
    <div
      className={cn(cellClass(density), "shrink-0 border-l")}
      title={`India VIX: expected 30-day volatility of the Nifty${read ? `, ${read.toLowerCase()}` : ""}`}
    >
      <span className="text-muted-foreground">{item.label}</span>
      {quote ? (
        <>
          <span
            ref={flash}
            className="rounded-sm num font-medium text-foreground"
          >
            {fmt2(quote.ltp)}
          </span>
          <Change change={change} pct={pct} short={density >= 2} />
          {read && density < 3 ? (
            <span className="rounded-sm bg-seg-track px-1.5 text-[11px] leading-[18px] text-soft">
              {read}
            </span>
          ) : null}
        </>
      ) : (
        <Skeleton className="h-3 w-[14ch]" />
      )}
    </div>
  )
}

/**
 * The indices under the nav bar, all of them always: when the width runs short the cells set tighter
 * (see Density) instead of hiding any behind a menu. Only past the tightest step does the row scroll
 * sideways. India VIX is pinned at the right; a button there hides the strip when a chart needs the room.
 */
export function IndexStrip({ onHide }: { onHide: () => void }) {
  const strip = useRef<HTMLElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinned = useRef<HTMLDivElement>(null)
  const [density, setDensity] = useState<Density>(0)
  // The width the cells needed at each step, as last measured: says when a looser step fits again.
  const need = useRef<(number | undefined)[]>([])
  const { list } = useUniverse()
  const expiries = useMemo(
    () => new Map(list.map((u) => [u.id, nearestExpiry(u.expiries)])),
    [list]
  )

  useLayoutEffect(() => {
    const fit = () => {
      const box = row.current
      const cells = content.current
      if (!box || !cells) return
      // VIX sets tighter with the rest, so it is counted on both sides: the room is the row and VIX together.
      const vix = pinned.current?.offsetWidth ?? 0
      const room = box.clientWidth + vix
      setDensity((d) => {
        need.current[d] = cells.offsetWidth + vix
        if (need.current[d]! > room && d < TIGHTEST) return (d + 1) as Density
        const looser = need.current[d - 1]
        if (d > 0 && looser !== undefined && looser <= room)
          return (d - 1) as Density
        return d
      })
    }
    fit()
    // The strip for its room, the cells for what they need (prices arrive and change width).
    const watch = new ResizeObserver(fit)
    if (row.current) watch.observe(row.current)
    if (content.current) watch.observe(content.current)
    return () => watch.disconnect()
  }, [])

  return (
    <nav
      ref={strip}
      aria-label="Indices"
      className="flex h-8 shrink-0 items-center border-b bg-chrome"
    >
      <div
        ref={row}
        className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto bg-chrome"
      >
        <div ref={content} className="flex w-max items-center">
          {ITEMS.map((item, i) => (
            <Cell
              key={item.id}
              item={item}
              first={i === 0}
              density={density}
              expiry={item.options ? expiries.get(item.id) : undefined}
            />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pr-1">
        <div ref={pinned} className="flex">
          {VIX ? <VixCell item={VIX} density={density} /> : null}
        </div>
        <Tip label="Hide indices">
          <ToolButton
            aria-label="Hide indices"
            className="h-6 min-w-6 px-0"
            onClick={onHide}
          >
            <ChevronUpIcon />
          </ToolButton>
        </Tip>
      </div>
    </nav>
  )
}
