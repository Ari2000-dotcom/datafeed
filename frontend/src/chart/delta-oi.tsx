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
import { expiryLabel, fmt0, fmt2, istDate, MINUS, toneOf } from "@/lib/format"
import { hub } from "@/lib/hub"
import { nearestStrike, useChain, type ChainStrike } from "@/lib/use-chain"
import { useQuote } from "@/lib/use-hub"
import { useDayHistory, type DayHistory } from "@/lib/delta-oi-day"
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
  /** Open interest added (or shed) today: now against yesterday's close. */
  callChg: number | null
  putChg: number | null
  /** Delta times today's OI change: the exposure written or closed today. */
  callDoiDay: number | null
  putDoiDay: number | null
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
  /** Today's share of the totals: delta times the OI change since yesterday. */
  callDay: number
  putDay: number
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
  let callDay = 0
  let putDay = 0
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
    const callChg = callOiV !== null && cq?.poi !== undefined ? callOiV - cq.poi : null
    const putChg = putOiV !== null && pq?.poi !== undefined ? putOiV - pq.poi : null
    const callDoiDay = callDelta !== null && callChg !== null ? callDelta * callChg * multiplier : null
    const putDoiDay = putDelta !== null && putChg !== null ? putDelta * putChg * multiplier : null
    if (callDoi !== null) callTotal += callDoi
    if (putDoi !== null) putTotal += putDoi
    if (callOiV !== null) callOi += callOiV * multiplier
    if (putOiV !== null) putOi += putOiV * multiplier
    if (callDoiDay !== null) callDay += callDoiDay
    if (putDoiDay !== null) putDay += putDoiDay
    if (callDoi !== null && putDoi !== null) covered++
    return {
      strike: r.strike,
      callOi: callOiV,
      putOi: putOiV,
      callDelta,
      putDelta,
      callDoi,
      putDoi,
      callChg,
      putChg,
      callDoiDay,
      putDoiDay,
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
  return { rows, forward, atmIv, callTotal, putTotal, callOi, putOi, callDay, putDay, covered }
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

// --- the net (day) view ----------------------------------------------------------------------------

interface Sample {
  /** Minute, ms. */
  t: number
  call: number
  put: number
}

const SAMPLE_CAP = 480

/**
 * The totals through the day, one point a minute while the board is open. Kept in this browser for
 * the day (a convenience, nothing on the server), so coming back to the board continues the line.
 */
function useDaySeries(key: string, board: Board | null, beat: number): Sample[] {
  const day = new Date(beat + 330 * 60_000).toISOString().slice(0, 10)
  const storeKey = `ah:doi:${key}:${day}`
  const minute = Math.floor(beat / 60_000) * 60_000
  // Read on the board's one-second clock, so a point written this minute shows on the next beat.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const samples = useMemo(() => readSamples(storeKey), [storeKey, beat])

  useEffect(() => {
    if (!board || board.covered === 0) return
    const kept = readSamples(storeKey)
    if (kept.at(-1)?.t === minute) return
    try {
      localStorage.setItem(storeKey, JSON.stringify([...kept, { t: minute, call: board.callTotal, put: board.putTotal }].slice(-SAMPLE_CAP)))
    } catch {
      // Not kept: storage is full or blocked; the board still shows its totals.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minute, storeKey, board?.covered])
  return samples
}

function readSamples(storeKey: string): Sample[] {
  try {
    const raw = localStorage.getItem(storeKey)
    return raw ? (JSON.parse(raw) as Sample[]) : []
  } catch {
    return []
  }
}

/** A line or two through the day on a shared scale, drawn in SVG: crisp at any width, a zero rule when the values cross it. */
function DayLines({ lines, height = 120, zero = false }: { lines: { values: number[]; color: string; label: string }[]; height?: number; zero?: boolean }) {
  const all = lines.flatMap((l) => l.values)
  const n = Math.max(...lines.map((l) => l.values.length))
  if (n < 2) return null
  let lo = Math.min(...all, zero ? 0 : Infinity)
  let hi = Math.max(...all, zero ? 0 : -Infinity)
  if (hi === lo) {
    hi += 1
    lo -= 1
  }
  const pad = (hi - lo) * 0.08
  lo -= pad
  hi += pad
  const x = (i: number) => (i / (n - 1)) * 100
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden>
      {zero && lo < 0 && hi > 0 ? <line x1="0" x2="100" y1={y(0)} y2={y(0)} className="stroke-separator-strong" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" /> : null}
      {lines.map((l) => (
        <polyline
          key={l.label}
          fill="none"
          stroke={l.color}
          strokeWidth={1.75}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          points={l.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        />
      ))}
    </svg>
  )
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <span className="flex items-center gap-3 type-meta">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </span>
  )
}

/** One side's total, large, with what today added to it under it. */
function SideTotal({ label, value, today, tone }: { label: string; value: number; today: number; tone: "up" | "down" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-2 type-label">
        <span aria-hidden className={cn("size-2 rounded-full", tone === "up" ? "bg-up" : "bg-down")} />
        {label}
      </span>
      <span className="num text-[26px] leading-8 font-medium tracking-[-0.01em] text-foreground">{signedCompact(value)}</span>
      <span className="type-meta">
        Today <span className={cn("num", TONE_TEXT[toneOf(today)])}>{signedCompact(today)}</span>
      </span>
    </div>
  )
}

/**
 * The whole board in a few numbers: total call and put delta × OI, which side outweighs the other
 * and by how much, what today's new open interest added, and the totals through the day.
 */
function NetDayView({ board, samples: recorded, history, unitWord }: { board: Board; samples: Sample[]; history: DayHistory; unitWord: string }) {
  // The day from history where the hub has it, then this board's own minutes after its last point.
  const fromHistory = history.kind === "ready" && history.points.length > 0
  const lastHistory = fromHistory ? history.points[history.points.length - 1]!.t : 0
  const samples: Sample[] = fromHistory
    ? [...history.points, ...recorded.filter((s) => s.t > lastHistory && istDate(s.t) === history.day)]
    : recorded
  const net = board.callTotal + board.putTotal
  const netDay = board.callDay + board.putDay
  const callShare = board.callTotal + Math.abs(board.putTotal) > 0 ? board.callTotal / (board.callTotal + Math.abs(board.putTotal)) : 0.5
  const up = "var(--up)"
  const down = "var(--down)"
  const since = samples[0] ? new Date(samples[0].t + 330 * 60_000).toISOString().slice(11, 16) : null
  return (
    <div className="flex flex-col">
      <div className="grid gap-6 border-b px-5 py-5 @xl/chart:grid-cols-[1fr_1fr_1.1fr]">
        <SideTotal label="Total call delta × OI" value={board.callTotal} today={board.callDay} tone="up" />
        <SideTotal label="Total put delta × OI" value={board.putTotal} today={board.putDay} tone="down" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="type-label">Net</span>
          <span className={cn("num text-[26px] leading-8 font-medium tracking-[-0.01em]", TONE_TEXT[toneOf(net)])}>{signedCompact(net)}</span>
          <span className="type-meta">
            {net > 0 ? "Calls outweigh puts" : net < 0 ? "Puts outweigh calls" : "Even"} · today{" "}
            <span className={cn("num", TONE_TEXT[toneOf(netDay)])}>{signedCompact(netDay)}</span>
          </span>
        </div>
      </div>

      {/* The balance: how the book splits between calls and puts, one bar. */}
      <div className="flex flex-col gap-2 border-b px-5 py-4">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-seg-track">
          <span className="bg-up/80 transition-[width] duration-500" style={{ width: `${callShare * 100}%` }} />
          <span className="flex-1 bg-down/80" />
        </div>
        <div className="flex justify-between type-meta">
          <span>
            Calls <span className="num text-soft">{(callShare * 100).toFixed(1)}%</span> · {compact(board.callOi)} {unitWord} OI
          </span>
          <span>
            {compact(board.putOi)} {unitWord} OI · Puts <span className="num text-soft">{((1 - callShare) * 100).toFixed(1)}%</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span data-card-title className="text-[13px]">
            Through the day
          </span>
          <Legend items={[{ color: up, label: "Calls" }, { color: down, label: "Puts" }]} />
        </div>
        {samples.length >= 2 ? (
          <>
            <DayLines
              lines={[
                { label: "Calls", color: up, values: samples.map((s) => s.call) },
                { label: "Puts", color: down, values: samples.map((s) => Math.abs(s.put)) },
              ]}
            />
            <div className="flex items-baseline justify-between">
              <span className="type-label">Net</span>
              <span className="type-meta">Above the dashed line, calls outweigh puts</span>
            </div>
            <DayLines zero height={72} lines={[{ label: "Net", color: "var(--primary)", values: samples.map((s) => s.call + s.put) }]} />
            <span className="type-meta">
              {fromHistory
                ? `From ${since} IST: open interest every 5 minutes (Nubra) with the straddle's forward and ATM vol, then live.`
                : `One point a minute since ${since} IST, recorded while this board is open.`}
            </span>
          </>
        ) : (
          <p className="py-6 text-center type-meta">
            {history.kind === "loading"
              ? "Loading the day so far…"
              : "The day's history is not available here, so the line starts now: one point a minute while this board is open."}
          </p>
        )}
      </div>
    </div>
  )
}

// --- the strike-wise view --------------------------------------------------------------------------

/** A bar from the left, scaled to the board's largest exposure, its figure on it. */
function BarCell({ value, scale, tone }: { value: number | null; scale: number; tone: "up" | "down" }) {
  const width = value !== null && scale > 0 ? Math.min(100, (Math.abs(value) / scale) * 100) : 0
  return (
    <TableCell className={cn(CELL, "min-w-24")}>
      <div className="relative flex h-5 items-center">
        <div className={cn("absolute inset-y-0 left-0 rounded-sm", tone === "up" ? "bg-up/25" : "bg-down/25")} style={{ width: `${width}%` }} />
        <span className="relative z-0 w-full pl-1.5 num text-xs">{value !== null ? signedCompact(value) : "-"}</span>
      </div>
    </TableCell>
  )
}

/**
 * Strike by strike, the strike and its open interest first: what is open and what changed today on
 * the left, the exposure that makes and the strike's net on the right. Only the money strike is lit.
 */
function StrikeTable({ board, scale, unit, lot, loading }: { board: Board | null; scale: number; unit: "contracts" | "lots"; lot: number; loading: boolean }) {
  const m = unit === "lots" ? lot : 1
  const oi = (v: number | null) => (v !== null ? compact(v * m) : "-")
  const chg = (v: number | null) =>
    v !== null ? <span className={TONE_TEXT[toneOf(v)]}>{signedCompact(v * m)}</span> : "-"
  return (
    <Table containerClassName="min-h-0 flex-1 overflow-auto bg-card">
      <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
        <TableRow className="hover:bg-transparent">
          <TableHead className={cn(HEAD, "pl-4")}>Strike</TableHead>
          <TableHead className={cn(HEAD, "text-right")}>Call OI</TableHead>
          <TableHead className={cn(HEAD, "text-right")}>Put OI</TableHead>
          <TableHead className={cn(HEAD, "text-right")}>Call OI today</TableHead>
          <TableHead className={cn(HEAD, "text-right")}>Put OI today</TableHead>
          <TableHead className={HEAD}>Call delta × OI</TableHead>
          <TableHead className={HEAD}>Put delta × OI</TableHead>
          <TableHead className={cn(HEAD, "pr-4 text-right")}>Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!board || loading
          ? Array.from({ length: 9 }, (_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                {Array.from({ length: 8 }, (_, j) => (
                  <TableCell key={j} className={CELL}>
                    <Skeleton className="h-4 w-14" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : board.rows.map((r) => {
              const net = r.callDoi !== null && r.putDoi !== null ? r.callDoi + r.putDoi : null
              return (
                <TableRow
                  key={r.strike}
                  aria-current={r.atm ? "true" : undefined}
                  className={cn(r.atm && "bg-primary/8 shadow-[inset_2px_0_0_var(--primary)] hover:bg-primary/12")}
                  title={`Strike ${fmt0(r.strike)}: call delta ${r.callDelta?.toFixed(2) ?? "-"}, put delta ${r.putDelta?.toFixed(2) ?? "-"}`}
                >
                  <TableCell className={cn(CELL, "pl-4 num", r.atm ? "font-medium text-primary-ink" : "text-foreground")}>
                    {fmt0(r.strike)}
                    {r.atm ? <span className="ml-2 rounded-[4px] bg-primary/15 px-1 text-[10px] font-medium text-primary-ink">ATM</span> : null}
                  </TableCell>
                  <TableCell className={cn(CELL, "text-right num text-soft")}>{oi(r.callOi)}</TableCell>
                  <TableCell className={cn(CELL, "text-right num text-soft")}>{oi(r.putOi)}</TableCell>
                  <TableCell className={cn(CELL, "text-right num text-xs")}>{chg(r.callChg)}</TableCell>
                  <TableCell className={cn(CELL, "text-right num text-xs")}>{chg(r.putChg)}</TableCell>
                  <BarCell value={r.callDoi} scale={scale} tone="up" />
                  <BarCell value={r.putDoi} scale={scale} tone="down" />
                  <TableCell className={cn(CELL, "pr-4 text-right num text-xs", net !== null ? TONE_TEXT[toneOf(net)] : "text-subtle")}>
                    {net !== null ? signedCompact(net) : "-"}
                  </TableCell>
                </TableRow>
              )
            })}
      </TableBody>
    </Table>
  )
}

type View = "net" | "strikes"

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
  const [view, setViewState] = useState<View>(() => {
    try {
      return localStorage.getItem("ah:doi:view") === "strikes" ? "strikes" : "net"
    } catch {
      return "net"
    }
  })
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem("ah:doi:view", v)
    } catch {
      // Remembered for this visit only.
    }
  }

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
  // The day's line is kept per market, expiry, band and unit: each is a different total.
  const samples = useDaySeries(`${underlying}:${expiry}:${band}:${unit}`, board, beat)
  const history = useDayHistory(underlying, expiry, band, board?.forward ?? null, unit === "lots" ? lot : 1)

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
      {view === "strikes" ? (
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

      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
        <Segmented
          value={view}
          onChange={setView}
          label="View"
          items={[
            { value: "net", label: "Net (day)" },
            { value: "strikes", label: "Strike-wise" },
          ]}
        />
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
          Open interest appears once the options start trading.
        </div>
      ) : null}

      {view === "net" ? (
        board && state.status !== "loading" ? (
          <NetDayView board={board} samples={samples} history={history} unitWord={unitWord} />
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <Skeleton className="h-8 w-[60%]" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-[120px] w-full" />
          </div>
        )
      ) : (
        <StrikeTable board={board} scale={scale} unit={unit} lot={lot} loading={state.status === "loading"} />
      )}
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
      className="@container/chart flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden panel bg-card"
    >
      <div className="panel-head [--panel-rule:var(--separator-strong)] flex h-[38px] shrink-0 items-center gap-x-3 overflow-hidden bg-chart-toolbar px-1.5">
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
