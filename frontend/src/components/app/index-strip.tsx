import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"

import { ChevronDownIcon, ChevronUpIcon } from "@/components/icons"
import { TONE_TEXT } from "@/components/app/move"
import { Tip, ToolButton } from "@/components/app/toolbar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { expiryLabel, fmt2, nearestExpiry, signed, signedPct, toneOf } from "@/lib/format"
import { FEATURED, type FeaturedIndex } from "@/lib/instruments"
import { hrefOf, navigate } from "@/lib/router"
import { useDay } from "@/lib/use-day"
import { useUniverse } from "@/lib/use-hub"
import { useTickFlash } from "@/lib/use-tick-flash"
import { cn } from "@/lib/utils"

/** The room the hide button and the "more" button need at the strip's right end, px. */
const HIDE_W = 36
const MORE_W = 64

const ITEMS = FEATURED.filter((i) => i.strip)

/** "+387.70 (+1.68%)": the points and the percent together, in the move's colour, as a broker's strip sets them. */
function Change({ change, pct }: { change: number | null; pct: number | null }) {
  if (change === null || pct === null) return <span className="num text-muted-foreground">-</span>
  return (
    <span className={cn("num", TONE_TEXT[toneOf(pct)])}>
      {signed(change)} ({signedPct(pct)})
    </span>
  )
}

/**
 * One index in the strip, as a broker's ticker sets it: the name a step quieter than the price, the
 * price, the move in its colour, and the nearest options expiry last and smallest. A hairline at the
 * start of each cell after the first keeps the figures of two indices from reading as one run.
 */
function Cell({ item, expiry, hidden, first }: { item: FeaturedIndex; expiry: string | undefined; hidden: boolean; first: boolean }) {
  const { quote, pct, change } = useDay(item.id, { spark: false })
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)
  const body = (
    <>
      <span className="text-muted-foreground">{item.label}</span>
      {quote ? (
        <>
          <span ref={flash} className="num rounded-sm font-medium text-foreground">
            {fmt2(quote.ltp)}
          </span>
          <Change change={change} pct={pct} />
        </>
      ) : (
        <>
          <Skeleton className="h-3 w-[8ch]" />
          <Skeleton className="h-3 w-[12ch]" />
        </>
      )}
      {expiry ? (
        <span className="num type-meta" title="Nearest options expiry">
          {expiryLabel(expiry)}
        </span>
      ) : null}
    </>
  )
  const cell = "flex h-8 items-center gap-2.5 px-4 text-[13px] outline-none whitespace-nowrap"
  return (
    // Measured whole, then shown or kept out of sight: a cell that does not fit is invisible, never half drawn.
    <div className={cn("flex shrink-0 items-center", hidden && "invisible")} aria-hidden={hidden || undefined}>
      {first ? null : <span className="h-4 w-px bg-border" aria-hidden />}
      {item.options ? (
        <a href={hrefOf.charts(item.id)} tabIndex={hidden ? -1 : undefined} title={`${item.name}: open the chart`} className={cn(cell, "transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset")}>
          {body}
        </a>
      ) : (
        <div className={cell}>{body}</div>
      )}
    </div>
  )
}

/** A row of the "more" menu: the same figures. */
function MoreRow({ item, expiry }: { item: FeaturedIndex; expiry: string | undefined }) {
  const { quote, pct, change } = useDay(item.id, { spark: false })
  return (
    <DropdownMenuItem onSelect={() => item.options && navigate(hrefOf.charts(item.id))} className="gap-3">
      <span className="font-medium">{item.label}</span>
      <span className="num ml-auto">{quote ? fmt2(quote.ltp) : "-"}</span>
      <Change change={change} pct={pct} />
      {expiry ? <span className="num text-[11px] text-subtle">{expiryLabel(expiry)}</span> : null}
    </DropdownMenuItem>
  )
}

/**
 * The indices under the nav bar: as many as the width allows, the rest in a "+N" menu, and a button to
 * hide the whole strip when the room is worth more to a chart.
 */
export function IndexStrip({ onHide }: { onHide: () => void }) {
  const strip = useRef<HTMLElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(ITEMS.length)
  const { list } = useUniverse()
  const expiries = useMemo(() => new Map(list.map((u) => [u.id, nearestExpiry(u.expiries)])), [list])

  const measure = useCallback(() => {
    const box = strip.current
    const cells = row.current ? ([...row.current.children] as HTMLElement[]) : []
    if (!box || cells.length === 0) return
    const widths = cells.map((c) => c.offsetWidth)
    const room = box.clientWidth - HIDE_W
    if (widths.reduce((a, b) => a + b, 0) <= room) return setFit(cells.length)
    let used = 0
    let n = 0
    for (const w of widths) {
      if (used + w > room - MORE_W) break
      used += w
      n++
    }
    setFit(Math.max(1, n))
  }, [])

  useLayoutEffect(() => {
    measure()
    const watch = new ResizeObserver(measure)
    if (strip.current) watch.observe(strip.current)
    for (const cell of row.current?.children ?? []) watch.observe(cell)
    return () => watch.disconnect()
  }, [measure])

  const rest = ITEMS.slice(fit)
  return (
    <nav ref={strip} aria-label="Indices" className="flex h-8 shrink-0 items-center border-b bg-chrome">
      <div ref={row} className="flex min-w-0 flex-1 items-center overflow-hidden bg-chrome">
        {ITEMS.map((item, i) => (
          <Cell key={item.id} item={item} first={i === 0} expiry={item.options ? expiries.get(item.id) : undefined} hidden={i >= fit} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 px-1">
        {rest.length > 0 ? (
          <DropdownMenu>
            <Tip label="More indices">
              <DropdownMenuTrigger asChild>
                <ToolButton aria-label={`${rest.length} more indices`} className="h-6 gap-1 px-1.5 text-xs">
                  <span className="num">+{rest.length}</span>
                  <ChevronDownIcon size={12} />
                </ToolButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="w-96">
              {rest.map((item) => (
                <MoreRow key={item.id} item={item} expiry={item.options ? expiries.get(item.id) : undefined} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Tip label="Hide indices">
          <ToolButton aria-label="Hide indices" className="h-6 min-w-6 px-0" onClick={onHide}>
            <ChevronUpIcon />
          </ToolButton>
        </Tip>
      </div>
    </nav>
  )
}
