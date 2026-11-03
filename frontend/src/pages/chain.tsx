import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { AlertIcon, RetryIcon } from "@/components/icons"
import { Segmented } from "@/components/app/toolbar"

import { Move, TONE_TEXT } from "@/components/app/move"
import { ExpiryPicker, UnderlyingPicker, useExpiries } from "@/components/app/pickers"
import { PageHeader } from "@/components/app/page-header"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { daysTo, fmt0, fmt2, fmtCompact, MINUS, toneOf } from "@/lib/format"
import { hub } from "@/lib/hub"
import { hrefOf, navigate, type Route } from "@/lib/router"
import { nearestStrike, useChain, type ChainStrike } from "@/lib/use-chain"
import { useDay } from "@/lib/use-day"
import { useQuote, useReference, useUniverse } from "@/lib/use-hub"
import { useTickFlash } from "@/lib/use-tick-flash"
import { cn } from "@/lib/utils"

const RANGES = [8, 12, 20, 30] as const
const DEFAULT_RANGE = 12
/** The window re-centres once the money has moved this many strikes from its middle. */
const RECENTRE_AFTER = 3

/** The largest open interest among these legs, live, so the bars scale to what is on screen. */
function useMaxOi(ids: string[]): number {
  const key = ids.join("|")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subscribe = useCallback((fn: () => void) => {
    const offs = ids.map((id) => hub.watch(id, fn))
    return () => offs.forEach((off) => off())
  }, [key])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapshot = useCallback(() => ids.reduce((max, id) => Math.max(max, hub.quote(id)?.oi ?? 0), 0), [key])
  return useSyncExternalStore(subscribe, snapshot)
}

const strikeFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 })

const HEAD = "h-9 px-3 type-label"
const CELL = "h-9 px-3 py-0"

/** One leg's three cells. Open interest carries a bar growing away from the strike, in neutral ink. */
function LegCells({ id, side, maxOi, itm }: { id: string; side: "call" | "put"; maxOi: number; itm: boolean }) {
  const quote = useQuote(id)
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)
  const oi = quote?.oi
  const dOi = oi !== undefined && quote?.poi !== undefined ? oi - quote.poi : null
  const bar = oi !== undefined && maxOi > 0 ? (oi / maxOi) * 100 : 0
  const wash = itm ? "bg-muted/50" : ""

  const oiCell = (
    <TableCell key="oi" className={cn(CELL, "w-[17%] min-w-32", wash)}>
      <div className="relative flex h-5 items-center">
        <div className={cn("absolute inset-y-0 rounded-sm bg-foreground/10", side === "call" ? "right-0" : "left-0")} style={{ width: `${bar}%` }} />
        <span className={cn("num relative w-full text-xs", side === "call" ? "text-right" : "text-left")}>{oi !== undefined ? fmtCompact(oi) : "-"}</span>
      </div>
    </TableCell>
  )
  const changeCell = (
    <TableCell key="chg" className={cn(CELL, "num text-xs", side === "call" ? "text-right" : "text-left", wash, dOi !== null ? TONE_TEXT[toneOf(dOi)] : "text-subtle")}>
      {dOi !== null ? (dOi === 0 ? "0" : `${dOi > 0 ? "+" : MINUS}${fmtCompact(Math.abs(dOi))}`) : "-"}
    </TableCell>
  )
  const ltpCell = (
    <TableCell key="ltp" className={cn(CELL, side === "call" ? "text-right" : "text-left", wash)}>
      {quote ? (
        <span ref={flash} className="num rounded-sm px-1">
          {fmt2(quote.ltp)}
        </span>
      ) : (
        <Skeleton className={cn("h-4 w-14", side === "call" && "ml-auto")} />
      )}
    </TableCell>
  )
  // Toward the strike, calls read OI, change, price; puts mirror it.
  return side === "call" ? [oiCell, changeCell, ltpCell] : [ltpCell, changeCell, oiCell]
}

const ChainRow = memo(function ChainRow({ row, spot, atm, maxOi }: { row: ChainStrike; spot: number | undefined; atm: boolean; maxOi: number }) {
  return (
    <TableRow data-atm={atm || undefined} className={cn(atm && "bg-accent")}>
      <LegCells id={row.call} side="call" maxOi={maxOi} itm={spot !== undefined && row.strike < spot} />
      <TableCell className={cn(CELL, "num w-28 text-center font-medium shadow-[inset_1px_0_0_var(--border),inset_-1px_0_0_var(--border)]", atm && "text-primary")}>{strikeFmt.format(row.strike)}</TableCell>
      <LegCells id={row.put} side="put" maxOi={maxOi} itm={spot !== undefined && row.strike > spot} />
    </TableRow>
  )
})

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="type-label">{label}</span>
      <span className="type-figure">{children}</span>
    </div>
  )
}

export function ChainPage({ route }: { route: Extract<Route, { name: "chain" }> }) {
  const { list } = useUniverse()
  const id = route.underlying ?? "nse:nifty"
  const underlying = list.find((u) => u.id === id)
  const { expiries, expiry } = useExpiries(underlying, route.expiry)

  const { state, retry } = useChain(underlying ? id : undefined, expiry)
  const reference = useReference(underlying)
  const day = useDay(reference, { spark: false })
  const spot = day.quote?.ltp

  const [range, setRange] = useState<number>(DEFAULT_RANGE)
  const strikes = state.status === "ready" ? state.strikes : null

  // The strike nearest the money, held steady until the money has really moved.
  const [middle, setMiddle] = useState<number | null>(null)
  const nearest = useMemo(() => nearestStrike(strikes, spot), [strikes, spot])
  useEffect(() => {
    setMiddle(null)
  }, [strikes])
  useEffect(() => {
    if (nearest === null) return
    setMiddle((m) => (m === null || Math.abs(m - nearest) >= RECENTRE_AFTER ? nearest : m))
  }, [nearest])

  const visible = useMemo(() => {
    if (!strikes) return []
    const centre = middle ?? Math.floor(strikes.length / 2)
    return strikes.slice(Math.max(0, centre - range), centre + range + 1)
  }, [strikes, middle, range])
  const atmStrike = nearest !== null && strikes ? strikes[nearest]!.strike : undefined
  const maxOi = useMaxOi(useMemo(() => visible.flatMap((r) => [r.call, r.put]), [visible]))

  // Bring the money row into view once per chain.
  const scrolled = useRef<string>("")
  useEffect(() => {
    const key = `${id}|${expiry}`
    if (middle === null || scrolled.current === key) return
    scrolled.current = key
    requestAnimationFrame(() => document.querySelector("[data-atm]")?.scrollIntoView({ block: "center" }))
  }, [middle, id, expiry])

  const days = expiry ? daysTo(expiry) : null
  const future = reference?.includes(":FUT") ?? false

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Option chain">
        <UnderlyingPicker value={id} list={list} onChange={(v) => navigate(hrefOf.chain(v))} />
        <ExpiryPicker value={expiry} expiries={expiries} onChange={(d) => navigate(hrefOf.chain(id, d))} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Fact label={future ? "Futures" : "Spot"}>{spot !== undefined ? fmt2(spot) : "-"}</Fact>
          <Move change={day.change} pct={day.pct} abs className="text-xs" />
          <Fact label="ATM">{atmStrike !== undefined ? strikeFmt.format(atmStrike) : "-"}</Fact>
          <Fact label="Lot">{underlying ? fmt0(underlying.lot) : "-"}</Fact>
          <Fact label="Expires">{days === null ? "-" : days === 0 ? "today" : `in ${days}d`}</Fact>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="type-label">Strikes each side</span>
          <Segmented value={String(range)} onChange={(v) => setRange(Number(v))} label="Strikes each side of the money" items={RANGES.map((n) => ({ value: String(n), label: <span className="num">{n}</span> }))} />
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col bg-background p-4">
        {state.status === "error" ? (
          <Empty className="rounded-lg border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertIcon />
              </EmptyMedia>
              <EmptyTitle>Could not load the chain</EmptyTitle>
              <EmptyDescription>{state.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={retry}>
                <RetryIcon data-icon="inline-start" />
                Try again
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          // The table scrolls inside its card and its column names stay pinned on top: the page opens on the
          // strikes round the money, and without them a row of figures could not be read.
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
            <Table containerClassName="min-h-0 flex-1 overflow-auto bg-card">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className={cn(HEAD, "text-right")}>Call OI</TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>OI change</TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>Call LTP</TableHead>
                  <TableHead className={cn(HEAD, "text-center")}>Strike</TableHead>
                  <TableHead className={HEAD}>Put LTP</TableHead>
                  <TableHead className={HEAD}>OI change</TableHead>
                  <TableHead className={HEAD}>Put OI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.status === "loading"
                  ? Array.from({ length: 12 }, (_, i) => (
                      <TableRow key={i} className="hover:bg-transparent">
                        {Array.from({ length: 7 }, (_, j) => (
                          <TableCell key={j} className={CELL}>
                            <Skeleton className={cn("h-4 w-16", j === 3 && "mx-auto", j < 3 && "ml-auto")} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : visible.map((row) => <ChainRow key={row.strike} row={row} spot={spot} atm={row.strike === atmStrike} maxOi={maxOi} />)}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
