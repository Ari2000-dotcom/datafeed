import { useEffect, useMemo, useState, type ReactNode } from "react"
import { AlertIcon, RetryIcon } from "@/components/icons"
import { FullscreenButton, useFullscreen } from "@/chart/frame"
import { Segmented } from "@/components/app/toolbar"

import { TONE_TEXT } from "@/components/app/move"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { delta76, impliedVol, yearsToExpiry } from "@/lib/black76"
import { expiryLabel, fmt0, fmt2, MINUS, toneOf } from "@/lib/format"
import { hub } from "@/lib/hub"
import { nearestStrike, useChain, type ChainStrike } from "@/lib/use-chain"
import { useQuote } from "@/lib/use-hub"
import { useNow } from "@/lib/use-now"
import { FolderTab } from "@/components/app/folder"
import { cn } from "@/lib/utils"

const BANDS = [5, 10, 20] as const
/** The money row's window re-centres once the spot has moved this many strikes. */
const RECENTRE_AFTER = 3

/** Indian short scale, as a desk reads it: 1.42 Cr, 44.10 L, 8.2 K. */
function compact(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? MINUS : ""
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(2)} L`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)} K`
  return `${sign}${fmt0(a)}`
}
const signedCompact = (v: number) => (v > 0 ? `+${compact(v)}` : compact(v))

interface Row {
  strike: number
  callOi: number | null
  putOi: number | null
  callDelta: number | null
  putDelta: number | null
  /** Delta times open interest; the put's is negative. */
  callDoi: number | null
  putDoi: number | null
  atm: boolean
}

interface Board {
  rows: Row[]
  forward: number | null
  atmIv: number | null
  callTotal: number
  putTotal: number
  callOi: number
  putOi: number
  covered: number
}

/** Keeps the live window still until the money has really moved, so legs are not re-subscribed on every tick. */
function useMiddle(nearest: number | null, resetKey: string): number | null {
  const [middle, setMiddle] = useState<number | null>(null)
  useEffect(() => setMiddle(null), [resetKey])
  useEffect(() => {
    if (nearest === null) return
    setMiddle((m) =>
      m === null || Math.abs(m - nearest) >= RECENTRE_AFTER ? nearest : m
    )
  }, [nearest])
  return middle
}

/** Keeps a set of instruments subscribed while mounted, without re-rendering on their ticks: the board reads them on a clock. */
function useWatch(ids: readonly string[]): void {
  const key = ids.join("|")
  useEffect(() => {
    const noop = () => undefined
    const offs = ids.map((id) => hub.watch(id, noop))
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/**
 * Delta x open interest, strike by strike: how much of the underlying each side of the book is
 * effectively long or short. One contract's OI says how many are outstanding, its delta how much
 * of the underlying one behaves like; multiplied and added, the calls give one number and the puts
 * another (negative, a put's delta is), and the two together say which way the board leans.
 *
 * Delta is Black-76 on the forward (call minus put plus strike at the money, so the basis the
 * options are priced against is in it), at each leg's own implied vol. Where a price sits at or
 * under intrinsic and no vol solves, the ATM vol stands in. Only a band of strikes each side of
 * the money is live: a browser holds one socket with a topic budget, so the whole chain is not.
 */
function compute(
  window: readonly ChainStrike[],
  atmStrike: number | undefined,
  spot: number | undefined,
  expiry: string,
  mcx: boolean,
  multiplier: number
): Board {
  const q = (id: string) => hub.quote(id)
  const t = yearsToExpiry(expiry, mcx)
  const atmRow = window.find((r) => r.strike === atmStrike)
  const c = atmRow ? q(atmRow.call)?.ltp : undefined
  const p = atmRow ? q(atmRow.put)?.ltp : undefined
  const forward =
    atmRow && c !== undefined && p !== undefined
      ? atmRow.strike + c - p
      : (spot ?? null)

  let atmIv: number | null = null
  if (forward !== null && atmRow && c !== undefined && p !== undefined) {
    const ivs = [
      impliedVol(c, forward, atmRow.strike, t, true),
      impliedVol(p, forward, atmRow.strike, t, false),
    ].filter((v): v is number => v !== null)
    if (ivs.length > 0) atmIv = ivs.reduce((a, b) => a + b, 0) / ivs.length
  }

  let callTotal = 0
  let putTotal = 0
  let callOi = 0
  let putOi = 0
  let covered = 0
  const rows = window.map((r): Row => {
    const cq = q(r.call)
    const pq = q(r.put)
    const callOiV = cq?.oi ?? null
    const putOiV = pq?.oi ?? null
    let callDelta: number | null = null
    let putDelta: number | null = null
    if (forward !== null) {
      const cv =
        (cq ? impliedVol(cq.ltp, forward, r.strike, t, true) : null) ?? atmIv
      const pv =
        (pq ? impliedVol(pq.ltp, forward, r.strike, t, false) : null) ?? atmIv
      if (cv !== null) callDelta = delta76(forward, r.strike, t, cv, true)
      if (pv !== null) putDelta = delta76(forward, r.strike, t, pv, false)
    }
    const callDoi =
      callDelta !== null && callOiV !== null
        ? callDelta * callOiV * multiplier
        : null
    const putDoi =
      putDelta !== null && putOiV !== null
        ? putDelta * putOiV * multiplier
        : null
    if (callDoi !== null) callTotal += callDoi
    if (putDoi !== null) putTotal += putDoi
    if (callOiV !== null) callOi += callOiV * multiplier
    if (putOiV !== null) putOi += putOiV * multiplier
    if (callDoi !== null && putDoi !== null) covered++
    return {
      strike: r.strike,
      callOi: callOiV,
      putOi: putOiV,
      callDelta,
      putDelta,
      callDoi,
      putDoi,
      atm: r.strike === atmStrike,
    }
  })
  // The money strike is the one nearest the forward, the options' own idea of where the underlying is.
  if (forward !== null) {
    let at = 0
    for (let i = 1; i < rows.length; i++)
      if (
        Math.abs(rows[i]!.strike - forward) <
        Math.abs(rows[at]!.strike - forward)
      )
        at = i
    rows.forEach((r, i) => (r.atm = i === at))
  }
  return { rows, forward, atmIv, callTotal, putTotal, callOi, putOi, covered }
}

function Stat({
  label,
  value,
  sub,
  tone,
  hint,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: string
  hint?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3" title={hint}>
      <span className="truncate type-label">{label}</span>
      <span className={cn("truncate type-figure-lg", tone)}>{value}</span>
      <span className="h-4 truncate type-meta">{sub}</span>
    </div>
  )
}

const HEAD = "h-9 px-3 type-label"
const CELL = "h-9 px-3 py-0"

/** A bar growing from the strike outward, scaled to the board's largest exposure, with its figure on it. */
function ExposureCell({
  value,
  scale,
  side,
}: {
  value: number | null
  scale: number
  side: "call" | "put"
}) {
  const width =
    value !== null && scale > 0
      ? Math.min(100, (Math.abs(value) / scale) * 100)
      : 0
  return (
    <TableCell className={cn(CELL, "w-[24%] min-w-40")}>
      <div className="relative flex h-5 items-center">
        <div
          className={cn(
            "absolute inset-y-0 rounded-sm",
            side === "call" ? "right-0 bg-up/30" : "left-0 bg-down/30"
          )}
          style={{ width: `${width}%` }}
        />
        <span
          className={cn(
            "relative z-0 w-full num text-xs",
            side === "call" ? "text-right" : "text-left"
          )}
        >
          {value !== null ? signedCompact(value) : "-"}
        </span>
      </div>
    </TableCell>
  )
}

export function DeltaOiBoard({
  underlying,
  lot,
  expiry,
  refId,
}: {
  underlying: string
  lot: number
  expiry: string | undefined
  refId: string | null
}) {
  const { state, retry } = useChain(underlying, expiry)
  const spotQuote = useQuote(refId)
  const spot = spotQuote?.ltp
  const strikes = state.status === "ready" ? state.strikes : null

  const [band, setBand] = useState<number>(10)
  const [unit, setUnit] = useState<"contracts" | "lots">("contracts")

  const nearest = nearestStrike(strikes, spot)
  const middle = useMiddle(
    nearest,
    `${underlying}|${expiry}|${strikes?.length ?? 0}`
  )
  const window = useMemo(() => {
    if (!strikes) return []
    const centre = middle ?? Math.floor(strikes.length / 2)
    return strikes.slice(Math.max(0, centre - band), centre + band + 1)
  }, [strikes, middle, band])
  const atmStrike =
    nearest !== null && strikes ? strikes[nearest]!.strike : undefined

  useWatch(useMemo(() => window.flatMap((r) => [r.call, r.put]), [window]))

  // Read on a one-second clock: forty legs tick many times a second and a figure a person reads need not.
  const beat = useNow()
  const board = useMemo(
    () =>
      expiry
        ? compute(
            window,
            atmStrike,
            spot,
            expiry,
            underlying.startsWith("mcx:"),
            unit === "lots" ? lot : 1
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [window, atmStrike, expiry, unit, lot, beat]
  )

  const scale = board
    ? Math.max(
        0,
        ...board.rows.flatMap((r) => [
          Math.abs(r.callDoi ?? 0),
          Math.abs(r.putDoi ?? 0),
        ])
      )
    : 0
  const net = board ? board.callTotal + board.putTotal : null
  const pcr = board && board.callOi > 0 ? board.putOi / board.callOi : null
  const noOi =
    board !== null &&
    board.rows.length > 0 &&
    board.rows.every((r) => r.callOi === null && r.putOi === null)
  const unitWord = unit === "lots" ? "units" : "contracts"

  if (state.status === "error") {
    return (
      <Empty className="flex-1">
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
    )
  }

  return (
    // Flat, as the straddle's figures are: a strip of figures, a row of controls, then the table, each
    // parted from the next by one line. Cards inside the container's own frame read as boxes in boxes.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-2 divide-x divide-y border-b bg-card @md/chart:grid-cols-3 @3xl/chart:grid-cols-6 @3xl/chart:divide-y-0">
        <Stat
          label="Call delta × OI"
          value={board ? signedCompact(board.callTotal) : "-"}
          sub={board ? `${compact(board.callOi)} ${unitWord} OI` : undefined}
          hint="Every call's delta times its open interest, added up"
        />
        <Stat
          label="Put delta × OI"
          value={board ? signedCompact(board.putTotal) : "-"}
          sub={board ? `${compact(board.putOi)} ${unitWord} OI` : undefined}
          hint="The same for the puts; negative, because a put's delta is"
        />
        <Stat
          label="Net"
          value={net !== null ? signedCompact(net) : "-"}
          tone={net !== null ? TONE_TEXT[toneOf(net)] : undefined}
          sub={
            net === null
              ? undefined
              : net > 0
                ? "Calls outweigh puts"
                : net < 0
                  ? "Puts outweigh calls"
                  : "Even"
          }
          hint="Call delta × OI plus put delta × OI"
        />
        <Stat
          label="Put / call OI"
          value={pcr !== null ? pcr.toFixed(2) : "-"}
          sub="Strikes shown"
          hint="Put open interest over call open interest, for the strikes shown"
        />
        <Stat
          label="ATM implied vol"
          value={
            board?.atmIv != null ? `${(board.atmIv * 100).toFixed(2)}%` : "-"
          }
          sub={
            board?.rows.find((r) => r.atm)
              ? `Strike ${fmt0(board.rows.find((r) => r.atm)!.strike)}`
              : undefined
          }
        />
        <Stat
          label="Forward"
          value={board?.forward != null ? fmt2(board.forward) : "-"}
          sub={spot !== undefined ? `Spot ${fmt2(spot)}` : undefined}
          hint="Call minus put plus strike at the money: what the deltas are taken on"
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="type-label">Strikes each side</span>
          <Segmented
            value={String(band)}
            onChange={(v) => setBand(Number(v))}
            label="Strikes each side of the money"
            items={BANDS.map((b) => ({
              value: String(b),
              label: <span className="num">{b}</span>,
            }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="type-label">Count in</span>
          <Segmented
            value={unit}
            onChange={setUnit}
            label="Units"
            items={[
              { value: "contracts", label: "Contracts" },
              { value: "lots", label: `Units of ${lot ? fmt0(lot) : "lot"}` },
            ]}
          />
        </div>
        {board ? (
          <span className="ml-auto num type-meta">
            {board.covered} of {board.rows.length} strikes counted
            {expiry ? `, expiry ${expiryLabel(expiry)}` : ""}
          </span>
        ) : null}
      </div>

      {noOi ? (
        <div className="shrink-0 border-b px-3 py-2 type-meta">
          No open interest from the feed yet. It appears once the legs tick.
        </div>
      ) : null}

      <Table containerClassName="min-h-0 flex-1 overflow-auto bg-card">
        <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, "text-right")}>Call OI</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>Delta</TableHead>
            <TableHead className={cn(HEAD, "text-right")}>
              Call delta × OI
            </TableHead>
            <TableHead className={cn(HEAD, "text-center")}>Strike</TableHead>
            <TableHead className={HEAD}>Put delta × OI</TableHead>
            <TableHead className={HEAD}>Delta</TableHead>
            <TableHead className={HEAD}>Put OI</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!board || state.status === "loading"
            ? Array.from({ length: 9 }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {Array.from({ length: 7 }, (_, j) => (
                    <TableCell key={j} className={CELL}>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : board.rows.map((r) => (
                <TableRow key={r.strike} className={cn(r.atm && "bg-accent")}>
                  <TableCell
                    className={cn(CELL, "text-right num text-muted-foreground")}
                  >
                    {r.callOi !== null
                      ? compact(r.callOi * (unit === "lots" ? lot : 1))
                      : "-"}
                  </TableCell>
                  <TableCell
                    className={cn(CELL, "text-right num text-muted-foreground")}
                  >
                    {r.callDelta !== null ? r.callDelta.toFixed(2) : "-"}
                  </TableCell>
                  <ExposureCell value={r.callDoi} scale={scale} side="call" />
                  <TableCell
                    className={cn(
                      CELL,
                      "text-center num font-medium shadow-[inset_1px_0_0_var(--border),inset_-1px_0_0_var(--border)]",
                      r.atm && "text-primary"
                    )}
                  >
                    {fmt0(r.strike)}
                  </TableCell>
                  <ExposureCell value={r.putDoi} scale={scale} side="put" />
                  <TableCell className={cn(CELL, "num text-muted-foreground")}>
                    {r.putDelta !== null ? r.putDelta.toFixed(2) : "-"}
                  </TableCell>
                  <TableCell className={cn(CELL, "num text-muted-foreground")}>
                    {r.putOi !== null
                      ? compact(r.putOi * (unit === "lots" ? lot : 1))
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * The board in a container of its own, framed as the charts are: a toolbar on the chrome colour above
 * (the pickers go there), the board scrolling below on the page colour, and the same active edge and
 * full screen. It is a container-query host, so the board's columns follow the container's width.
 */
export function DeltaOiPanel({
  toolbar,
  active,
  onActivate,
  ...board
}: { toolbar: ReactNode; active: boolean; onActivate: () => void } & Parameters<
  typeof DeltaOiBoard
>[0]) {
  const { ref, full, toggle } = useFullscreen<HTMLElement>()
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" onPointerDownCapture={onActivate}>
    <FolderTab title="Delta × OI" active={active} />
    <section
      ref={ref}
      aria-label="Delta × OI"
      data-active={active || undefined}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      className="@container/chart flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden panel rounded-tl-none bg-background"
    >
      <div className="panel-head flex h-[38px] shrink-0 items-center gap-x-3 overflow-hidden bg-chart-toolbar px-1.5">
        <div className="flex shrink-0 items-center gap-x-0.5">{toolbar}</div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <FullscreenButton full={full} onToggle={toggle} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-card">
        <DeltaOiBoard {...board} />
      </div>
    </section>
    </div>
  )
}
