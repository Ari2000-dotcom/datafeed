import { useLayoutEffect, useMemo, useRef, useState } from "react"

import { ChevronUpIcon } from "@/components/icons"
import { TONE_TEXT } from "@/components/app/move"
import { Tip, ToolButton } from "@/components/app/toolbar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  expiryLabel,
  fmt0,
  fmt2,
  MINUS,
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
 * How tightly the strip sets its tiles, so every index fits and none is put away in a menu. The move
 * in points and in percent always stays; what gives way first is the least useful:
 *   0  name and expiry over price, points and percent
 *   1  the expiry goes (it stays in the tile's tooltip)
 *   2  closer figures
 *   3  narrower tiles, and a move of 100 points or more in whole points ("+1,860")
 * Measured, never guessed from the window width: the step is the loosest one the row fits at.
 */
type Density = 0 | 1 | 2 | 3
const TIGHTEST: Density = 3

const PILL: Record<ReturnType<typeof toneOf>, string> = {
  up: "text-up",
  down: "text-down",
  flat: "text-muted-foreground",
}

/**
 * The day's move, both ways a trader reads it: the points then the percent, both in the move's
 * colour. The sign and the colour carry the direction, so there is no arrow and no tinted pill.
 */
function Change({ change, pct, tight = false, whole = false }: { change: number | null; pct: number | null; tight?: boolean; whole?: boolean }) {
  if (change === null || pct === null) return <span className="num text-[12px] text-subtle">-</span>
  const tone = toneOf(pct)
  return (
    <span className={cn("inline-flex items-center", tight ? "gap-1" : "gap-1.5")}>
      <span className={cn("num inline-flex items-center gap-1 text-[12px]", TONE_TEXT[tone])}>
        {whole && Math.abs(change) >= 100 ? `${change > 0 ? "+" : MINUS}${fmt0(Math.abs(change))}` : signed(change)}
      </span>
      <span className={cn("num text-[12px]", PILL[tone])}>{signedPct(pct)}</span>
    </span>
  )
}

/** One tile's frame: a rounded plate a step lighter than the bar, two lines inside. */
const tileClass = (density: Density) =>
  cn(
    "flex h-9 shrink-0 flex-col justify-center gap-px rounded-md bg-seg-track whitespace-nowrap outline-none",
    density >= 3 ? "px-2" : "px-2.5"
  )

/** The tile's top line: the index's name, and on the right whatever it notes (expiry, VIX's read). */
function TopLine({ name, note }: { name: string; note?: React.ReactNode }) {
  return (
    <span className="flex items-center justify-between gap-3 text-[11px] leading-[14px]">
      <span className="text-muted-foreground">{name}</span>
      {note}
    </span>
  )
}

/**
 * One index as a tile: its name (and the nearest options expiry) on top, the price and the move with
 * its arrow under it. Each tile stands on its own plate, so two indices never read as one run of
 * figures, and the strip reads as a row of markets, apart from the nav bar above it.
 */
function Cell({
  item,
  expiry,
  density,
}: {
  item: FeaturedIndex
  expiry: string | undefined
  density: Density
}) {
  const { quote, pct, change } = useDay(item.id)
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)
  const body = (
    <>
      <TopLine
        name={item.label}
        note={expiry && density < 1 ? <span className="num text-subtle">{expiryLabel(expiry)}</span> : null}
      />
      <span className={cn("flex items-center leading-[18px]", density >= 2 ? "gap-1.5" : "gap-2")}>
        {quote ? (
          <>
            <span ref={flash} className="rounded-sm num text-[13px] text-foreground">
              {fmt2(quote.ltp)}
            </span>
            <Change change={change} pct={pct} tight={density >= 2} whole={density >= 3} />
          </>
        ) : (
          <Skeleton className="h-3 w-[14ch]" />
        )}
      </span>
    </>
  )
  const title = `${item.name}${expiry ? `, options expire ${expiryLabel(expiry)}` : ""}`
  return item.options ? (
    <a
      href={hrefOf.charts(item.id)}
      title={`${title}. Open the chart.`}
      className={cn(tileClass(density), "transition-colors duration-150 hover:bg-selection")}
    >
      {body}
    </a>
  ) : (
    <div className={tileClass(density)} title={title}>
      {body}
    </div>
  )
}

const VIX_READ = {
  Calm: "text-up",
  Normal: "text-soft",
  High: "text-down",
} as const

/**
 * India VIX, pinned at the right: the level, its move on the day, and a one-word read of where it
 * sits (calm under 12, normal to 20, high above), so the market's fear gauge is always one glance away.
 */
function VixCell({ item, density }: { item: FeaturedIndex; density: Density }) {
  const { quote, pct, change } = useDay(item.id)
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)
  const level = quote?.ltp
  const read: keyof typeof VIX_READ | null =
    level === undefined ? null : level < 12 ? "Calm" : level <= 20 ? "Normal" : "High"
  return (
    <div
      className={tileClass(density)}
      title={`India VIX: expected 30-day volatility of the Nifty${read ? `, ${read.toLowerCase()}` : ""}`}
    >
      <TopLine name={item.label} note={read ? <span className={VIX_READ[read]}>{read}</span> : null} />
      <span className={cn("flex items-center leading-[18px]", density >= 2 ? "gap-1.5" : "gap-2")}>
        {quote ? (
          <>
            <span ref={flash} className="rounded-sm num text-[13px] text-foreground">
              {fmt2(quote.ltp)}
            </span>
            <Change change={change} pct={pct} tight={density >= 2} whole={density >= 3} />
          </>
        ) : (
          <Skeleton className="h-3 w-[10ch]" />
        )}
      </span>
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
  // More tiles than room even at the tightest step: the row scrolls, and its right edge fades to say so.
  const [more, setMore] = useState(false)
  // The width the cells needed at each step, as last measured: says when a looser step fits again.
  const need = useRef<(number | undefined)[]>([])
  const { list } = useUniverse()
  const expiries = useMemo(
    () => new Map(list.map((u) => [u.id, nearestExpiry(u.expiries)])),
    [list]
  )

  const fitRef = useRef<() => void>(() => undefined)
  // Measure again after every step: a step can change the row too little for the observer to fire.
  useLayoutEffect(() => fitRef.current(), [density])
  useLayoutEffect(() => {
    const fit = () => {
      const box = row.current
      const cells = content.current
      if (!box || !cells) return
      // VIX sets tighter with the rest, so it is counted on both sides: the room is the row and VIX together.
      const vix = pinned.current?.offsetWidth ?? 0
      const room = box.clientWidth + vix
      setMore(box.scrollWidth - box.scrollLeft > box.clientWidth + 1)
      setDensity((d) => {
        need.current[d] = cells.offsetWidth + vix
        if (need.current[d]! > room && d < TIGHTEST) return (d + 1) as Density
        const looser = need.current[d - 1]
        if (d > 0 && looser !== undefined && looser <= room)
          return (d - 1) as Density
        return d
      })
    }
    fitRef.current = fit
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
      className="flex h-12 shrink-0 items-center gap-1.5 border-t border-separator bg-chrome px-1.5"
    >
      <div className="relative flex min-w-0 flex-1">
      <div
        ref={row}
        onScroll={(e) => {
          const box = e.currentTarget
          setMore(box.scrollWidth - box.scrollLeft > box.clientWidth + 1)
        }}
        className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto bg-chrome"
      >
        <div ref={content} className="flex w-max items-center gap-1.5">
          {ITEMS.map((item) => (
            <Cell
              key={item.id}
              item={item}
              density={density}
              expiry={item.options ? expiries.get(item.id) : undefined}
            />
          ))}
        </div>
      </div>
      {more ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-r from-transparent to-chrome" />
      ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
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
