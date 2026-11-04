import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  PaneLegend,
  type LegendValue,
  type LinePoint,
  type SeriesApi,
  type Whitespace,
} from "openalgo-charts"

import { Move } from "@/components/app/move"
import { ChartFrame } from "@/chart/frame"
import { ChartTools } from "@/chart/tools"
import { useChart } from "@/chart/use-chart"
import { Tip, ToolButton, ToolDivider } from "@/components/app/toolbar"
import { ChevronDownIcon } from "@/components/icons"
import { LivePulse } from "@/chart/live-pulse"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  dateLabel,
  daysTo,
  fmt0,
  fmt2,
  istDate,
  pastWeekdays,
  sessionLabel,
} from "@/lib/format"
import { hub, type TopicMessage } from "@/lib/hub"
import { useHubStatus } from "@/lib/use-hub"

/** One straddle minute, as the hub sends it. `t` is the minute's start (epoch ms). */
interface StraddleBar {
  t: number
  spot: number
  strike: number
  atm: number
  call: number
  put: number
  straddle: number
  synth: number
  vwap: number | null
  iv: number | null
  vix: number | null
  rolled: boolean
}

/**
 * The lines, as the web build draws them. The premium and its VWAP read on the left axis; spot and
 * the synthetic future on the right, so a move in either is not flattened by the other's scale.
 * Under them one pane: India VIX on its left axis, the ATM implied vol on its right.
 */
const LINE = {
  straddle: "#ff9db8",
  vwap: "#f0dc4e",
  synth: "#6cb2ff",
  spot: "#a9a9b2",
  iv: "#ffb547",
  vix: "#3be0d3",
} as const

type Key =
  "straddle" | "vwap" | "call" | "put" | "synth" | "spot" | "iv" | "vix"
type Pick = (b: StraddleBar) => number | null

/** A #rrggbb colour at a strength, as the web build fades the lines that are context, not the read. */
function tint(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour)?.[1]
  if (!hex || alpha >= 1) return colour
  const n = parseInt(hex, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Spot and the synthetic future: half strength and a hairline, so the premium is what reads. */
const CONTEXT_ALPHA = 0.5
const VWAP_ALPHA = 0.9

/**
 * The share of the price pane's height spot and the synthetic future fill, centred: the band the
 * premium's own scale fills, so the two curves are drawn at one size and overlay each other.
 */
const SPOT_BAND = 0.8
/** The least span the band stands for, as a share of the price: a flat stretch is not blown up. */
const SPOT_MIN_SPAN = 0.0005

/** Pins the right scale so spot and the synthetic future sit centred on the minutes in view. */
function fitSpot(
  scale: ReturnType<SeriesApi["priceScale"]>,
  all: readonly StraddleBar[],
  view: { from: number; to: number }
) {
  const from = Math.max(0, Math.floor(view.from))
  const to = Math.min(all.length - 1, Math.ceil(view.to))
  let lo = Infinity
  let hi = -Infinity
  for (let i = from; i <= to; i++) {
    const b = all[i]!
    for (const v of [b.spot, b.synth]) {
      if (!Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (lo > hi) return
  const mid = (lo + hi) / 2
  const half = Math.max(hi - lo, mid * SPOT_MIN_SPAN) / SPOT_BAND / 2
  scale.setOptions({ marginTop: 0, marginBottom: 0 })
  scale.setFixedRange({ min: mid - half, max: mid + half })
}

const PAST = pastWeekdays(3)

const point = (b: StraddleBar, value: number | null): LinePoint | Whitespace =>
  value === null ? { time: b.t / 1000 } : { time: b.t / 1000, value }

function Stat({
  label,
  value,
  sub,
  hint,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2" title={hint}>
      <span className="truncate type-label">{label}</span>
      <span className="truncate type-figure">{value}</span>
      <span className="h-4 truncate type-meta">{sub}</span>
    </div>
  )
}

/** The height of the container this chart's canvas sits in, kept current. Taken from the frame, not the canvas, so hiding the figures row cannot feed back into it. */
function useFrameHeight(host: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const frame = host.current?.closest("section")
    if (!frame) return
    const watch = new ResizeObserver(() => setHeight(frame.clientHeight))
    watch.observe(frame)
    return () => watch.disconnect()
  }, [host])
  return height
}

/** The figures row, the toolbar and a pane's least height, px: what a container must be before the vol pane fits. */
const TOOLBAR_H = 36
const STATS_H = 54
const MAIN_PANE_H = 180
const VOL_PANE_H = 110
/** Below this height the figures row goes: the chart is worth more than the row. */
const STATS_FROM = 380

/** The minute at or before `t` (ms) in a list in time order, by bisection. */
function barAt(
  list: readonly StraddleBar[],
  t: number
): StraddleBar | undefined {
  let lo = 0
  let hi = list.length - 1
  if (hi < 0 || list[0]!.t > t) return list[0]
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (list[mid]!.t <= t) lo = mid
    else hi = mid - 1
  }
  return list[lo]
}

/**
 * The at-the-money straddle through the session: the call and the put at the strike nearest the
 * money, added. What the market is pricing for the move to expiry, minute by minute, with its
 * VWAP, the spot and synthetic future it rides on, and the implied vol and India VIX under it.
 *
 * Today is the hub's live feed (a snapshot of the session so far, then a bar a second); the three
 * sessions before are replayed from the hub's history. Panning back to the first minute pages the
 * session before it in, as the web build does, until the hub's three days run out.
 */
export function StraddleChart({
  underlying,
  name,
  expiry,
  active,
  onActivate,
  pickers,
}: {
  underlying: string
  name: string
  expiry: string | undefined
  active: boolean
  onActivate: () => void
  pickers?: React.ReactNode
}) {
  const status = useHubStatus()
  const { host, chart, colors } = useChart()
  // A short container drops what does not fit: first the figures row, then the vol pane under the straddle.
  const frameHeight = useFrameHeight(host)
  const showStats = frameHeight === 0 || frameHeight >= STATS_FROM
  const roomForVol =
    frameHeight === 0 ||
    frameHeight - TOOLBAR_H - (showStats ? STATS_H : 0) - MAIN_PANE_H >=
      VOL_PANE_H
  const [session, setSession] = useState<string>("today")
  // Before today's session has a bar, the chart opens on the last session traded instead of an empty
  // "today"; once per container, so picking Today again later is respected.
  const fellBack = useRef(false)
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready" } | { kind: "empty"; note: string }
  >({ kind: "loading" })
  const [version, setVersion] = useState(0)
  const [last, setLast] = useState<StraddleBar | null>(null)
  const [legs, setLegs] = useState<string[]>([])
  const [paging, setPaging] = useState<
    { kind: "idle" } | { kind: "loading"; day: string } | { kind: "done" }
  >({ kind: "idle" })
  /** The session picked, in time order. */
  const bars = useRef<StraddleBar[]>([])
  /** Earlier sessions paged in by panning back, in time order, all before `bars`. */
  const older = useRef<StraddleBar[]>([])
  const tried = useRef(new Set<string>())
  const lines = useRef<Partial<Record<Key, SeriesApi>>>({})
  const hovering = useRef(false)
  const paintLast = useRef<((b: StraddleBar) => void) | null>(null)
  const refitRef = useRef<(() => void) | null>(null)

  const apply = useCallback((b: StraddleBar) => {
    const l = lines.current
    l.straddle?.update(point(b, b.straddle))
    l.vwap?.update(point(b, b.vwap))
    l.call?.update(point(b, b.call))
    l.put?.update(point(b, b.put))
    l.synth?.update(point(b, b.synth))
    l.spot?.update(point(b, b.spot))
    l.iv?.update(point(b, b.iv))
    l.vix?.update(point(b, b.vix))
  }, [])

  // The data: the live feed for today, a request for a past session.
  useEffect(() => {
    if (!expiry || status !== "open") return
    setState({ kind: "loading" })
    bars.current = []
    older.current = []
    tried.current = new Set()
    setPaging({ kind: "idle" })
    setLast(null)
    const take = (list: StraddleBar[], note: string) => {
      bars.current = [...list].sort((a, b) => a.t - b.t)
      setLast(bars.current.at(-1) ?? null)
      setState(
        bars.current.length > 0 ? { kind: "ready" } : { kind: "empty", note }
      )
      setVersion((v) => v + 1)
    }

    if (session !== "today") {
      let cancelled = false
      hub
        .request<{ bars: StraddleBar[] }>(
          { op: "straddle_history", underlying, expiry, date: session },
          "straddle_history"
        )
        .then(
          (r) =>
            !cancelled &&
            take(r.bars, "The hub keeps no straddle for that day."),
          (e: unknown) =>
            !cancelled &&
            setState({
              kind: "empty",
              note:
                e instanceof Error ? e.message : "Could not load that session.",
            })
        )
      return () => {
        cancelled = true
      }
    }

    return hub.listen(
      `straddle:${underlying}:${expiry}`,
      (msg: TopicMessage) => {
        if (msg.t === "straddle_snapshot") {
          const backfill = String(msg.backfill ?? "")
          const empty = ((msg.bars as StraddleBar[] | undefined) ?? []).length === 0
          if (empty && backfill !== "loading" && !fellBack.current && PAST[0]) {
            fellBack.current = true
            setSession(PAST[0])
            return
          }
          take(
            (msg.bars as StraddleBar[]) ?? [],
            backfill === "loading"
              ? "The hub is still building today's session."
              : backfill.startsWith("failed")
                ? backfill
                : "No straddle yet for today: the market has not opened or the feed has not started."
          )
        } else if (msg.t === "straddle") {
          const bar = msg.bar as StraddleBar
          const prev = msg.prev as StraddleBar | null
          const list = bars.current
          for (const b of prev ? [prev, bar] : [bar]) {
            const tail = list.at(-1)
            if (tail && tail.t === b.t) list[list.length - 1] = b
            else if (!tail || b.t > tail.t) list.push(b)
            apply(b)
          }
          if (!hovering.current) paintLast.current?.(bar)
          refitRef.current?.()
          setLast(bar)
          setState((s) => (s.kind === "ready" ? s : { kind: "ready" }))
        }
      }
    )
  }, [underlying, expiry, session, status, apply])

  // The series, rebuilt when a snapshot lands, the palette changes or a leg is toggled.
  useEffect(() => {
    if (!chart || !colors || version === 0 || bars.current.length === 0) return
    const list = [...older.current, ...bars.current]
    const picks: Partial<Record<Key, Pick>> = {}
    // As the web build sets each line: its name in the box beside its axis tag, TradingView's dotted
    // rule across the plot for the lines the desk reads, the tag kept on the axis when scrolled back,
    // and only the VWAP broken between sessions (it restarts each day; the others carry on).
    const add = (
      key: Key,
      pane: number,
      side: "left" | "right",
      color: string,
      pick: Pick,
      look: {
        width?: number
        tag?: string
        priceLine?: boolean
        pct?: boolean
      } = {}
    ) => {
      const s = chart.addSeries("line", {
        paneIndex: pane,
        priceScaleId: side,
        priceFormat: {
          type: "custom",
          formatter: look.pct ? (v: number) => `${v.toFixed(2)}%` : fmt2,
        },
        style: {
          color,
          lineWidth: look.width ?? 2,
          title: look.tag,
          lastValueVisible: true,
          lastValueFollowsView: true,
          priceLineVisible: look.priceLine ?? false,
          sessionBreaks: key === "vwap",
        },
      })
      s.setData(list.map((b) => point(b, pick(b))))
      lines.current[key] = s
      picks[key] = pick
    }
    lines.current = {}
    // Added back to front, the premium last so it draws on top.
    add("synth", 0, "right", tint(LINE.synth, CONTEXT_ALPHA), (b) => b.synth, {
      width: 1,
      tag: "Syn fut",
      priceLine: true,
    })
    add("spot", 0, "right", tint(LINE.spot, CONTEXT_ALPHA), (b) => b.spot, {
      width: 1,
      tag: "Spot",
    })
    add("vwap", 0, "left", tint(LINE.vwap, VWAP_ALPHA), (b) => b.vwap, {
      width: 1,
      tag: "VWAP",
    })
    if (legs.includes("call"))
      add("call", 0, "left", colors.up, (b) => b.call, {
        width: 1,
        tag: "Call",
      })
    if (legs.includes("put"))
      add("put", 0, "left", colors.down, (b) => b.put, { width: 1, tag: "Put" })
    add("straddle", 0, "left", LINE.straddle, (b) => b.straddle, {
      tag: "Straddle",
      priceLine: true,
    })

    const hasIv = list.some((b) => b.iv !== null)
    const hasVix = list.some((b) => b.vix !== null)
    const volPane = roomForVol && (hasIv || hasVix) ? 1 : -1
    if (volPane > 0) {
      if (hasVix)
        add("vix", volPane, "left", LINE.vix, (b) => b.vix, { tag: "VIX" })
      if (hasIv)
        add("iv", volPane, "right", LINE.iv, (b) => b.iv, {
          tag: "IV",
          priceLine: true,
          pct: true,
        })
      chart.setPaneWeight(0, 2)
      chart.setPaneWeight(volPane, 1)
    }

    // TradingView's status line: the chart's name, then each line's reading in its colour.
    const legends: PaneLegend[] = []
    const mk = (
      pane: number,
      opts: ConstructorParameters<typeof PaneLegend>[0]
    ) => {
      const l = new PaneLegend({ font: 12, actions: [], ...opts })
      chart.addPrimitive(l, pane)
      legends.push(l)
      return l
    }
    // TradingView's status line: the name at 14px with the premium's readings after it on the same line.
    const head = mk(0, {
      id: "straddle",
      title: `${name} straddle`,
      params: expiry ? dateLabel(expiry) : undefined,
      row: 0,
      titleFont: 14,
      statusLine: { background: true, backgroundColor: colors.ground, backgroundOpacity: 0.86 },
    })
    const under = mk(0, {
      id: "spot-values",
      title: "",
      row: 1,
      statusLine: { title: false },
    })
    const vol =
      volPane > 0 && hasIv
        ? mk(volPane, { id: "iv", title: "ATM IV", color: LINE.iv, row: 0 })
        : null
    const vix =
      volPane > 0 && hasVix
        ? mk(volPane, {
            id: "vix",
            title: "India VIX",
            color: LINE.vix,
            row: hasIv ? 1 : 0,
          })
        : null

    // The live end of the premium line: a dot with rings drizzling out while the feed is sending.
    const pulses: LivePulse[] = []
    if (session === "today") {
      const p = new LivePulse(() => {
        const b = bars.current.at(-1)
        return b
          ? {
              time: b.t / 1000,
              value: b.straddle,
              colour: LINE.straddle,
              live: Date.now() - b.t < 180_000,
            }
          : null
      })
      chart.addPrimitive(p, 0)
      pulses.push(p)
    }
    const paint = (b: StraddleBar) => {
      const values: LegendValue[] = [
        { label: "Straddle", text: fmt2(b.straddle), color: LINE.straddle },
        {
          label: "VWAP",
          text: b.vwap !== null ? fmt2(b.vwap) : "-",
          color: LINE.vwap,
        },
      ]
      if (legs.includes("call"))
        values.push({ label: "Call", text: fmt2(b.call), color: colors.up })
      if (legs.includes("put"))
        values.push({ label: "Put", text: fmt2(b.put), color: colors.down })
      head.setValues(values)
      under.setValues([
        { label: "Syn fut", text: fmt2(b.synth), color: LINE.synth },
        { label: "Spot", text: fmt2(b.spot), color: LINE.spot },
      ])
      vol?.setValues([
        { text: b.iv !== null ? `${b.iv.toFixed(2)}%` : "-", color: LINE.iv },
      ])
      vix?.setValues([
        { text: b.vix !== null ? b.vix.toFixed(2) : "-", color: LINE.vix },
      ])
    }
    paintLast.current = paint
    const tail = bars.current.at(-1)
    if (tail) paint(tail)
    const off = chart.subscribeCrosshairMove((e) => {
      hovering.current = e.time !== null
      if (e.time === null) {
        const end = bars.current.at(-1)
        if (end) paint(end)
        return
      }
      const t = e.time * 1000
      const first = bars.current[0]
      const b =
        first && t < first.t ? barAt(older.current, t) : barAt(bars.current, t)
      if (b) paint(b)
    })

    // Panning to the first minute asks for the trading day before it, newest first, and puts it in
    // front; the chart keeps the same minutes in view. A day the hub has nothing for (a holiday) is
    // skipped for the one before; once the hub's days run out the loader stays quiet.
    let alive = true
    let busy = false
    chart.setHistoryLoader(() => {
      const start = older.current[0] ?? bars.current[0]
      if (busy || !start || !expiry) return
      const before = istDate(start.t)
      const days = PAST.filter((d) => d < before && !tried.current.has(d))
      if (days.length === 0) {
        setPaging({ kind: "done" })
        return
      }
      busy = true
      void (async () => {
        for (const day of days) {
          tried.current.add(day)
          setPaging({ kind: "loading", day })
          let got: StraddleBar[] = []
          try {
            const r = await hub.request<{ bars: StraddleBar[] }>(
              { op: "straddle_history", underlying, expiry, date: day },
              "straddle_history"
            )
            got = [...r.bars].sort((a, b) => a.t - b.t)
          } catch {
            got = []
          }
          if (!alive) return
          const head0 = older.current[0] ?? bars.current[0]
          got = head0 ? got.filter((b) => b.t < head0.t) : got
          if (got.length === 0) continue
          older.current = [...got, ...older.current]
          for (const [key, s] of Object.entries(lines.current) as [
            Key,
            SeriesApi,
          ][]) {
            const pick = picks[key]
            if (pick) s.prependData(got.map((b) => point(b, pick(b))))
          }
          busy = false
          setPaging({ kind: "idle" })
          chart.historyLoadComplete()
          refit()
          return
        }
        busy = false
        if (alive) setPaging({ kind: "done" })
      })()
    })

    // The whole of the picked session in view, earlier sessions paged in sitting off to the left.
    const lead = older.current.length
    chart.setVisibleLogicalRange({
      from: lead,
      to: lead + bars.current.length - 1,
    })
    // Spot and the synthetic future held centred on what is in view: refitted on a pan, a zoom, a live minute.
    const synthScale = lines.current.synth?.priceScale()
    const refit = () =>
      synthScale &&
      fitSpot(
        synthScale,
        [...older.current, ...bars.current],
        chart.getVisibleLogicalRange()
      )
    refitRef.current = refit
    refit()
    const offPan = chart.on("pan", refit)
    const offZoom = chart.on("zoom", refit)
    const made = lines.current
    return () => {
      alive = false
      offPan()
      offZoom()
      refitRef.current = null
      chart.setHistoryLoader(() => {})
      off()
      paintLast.current = null
      for (const p of pulses) chart.removePrimitive(p)
      for (const l of legends) chart.removePrimitive(l)
      for (const s of Object.values(made)) s.remove()
      if (lines.current === made) lines.current = {}
    }
  }, [
    chart,
    colors,
    version,
    legs,
    name,
    underlying,
    expiry,
    session,
    roomForVol,
  ])

  const first = useMemo(() => bars.current[0] ?? null, [version])
  const change = last && first ? last.straddle - first.straddle : null
  const pct =
    change !== null && first && first.straddle
      ? (change / first.straddle) * 100
      : null
  const dte = expiry ? daysTo(expiry) : null

  const toggleLeg = (leg: string) =>
    setLegs((cur) =>
      cur.includes(leg) ? cur.filter((l) => l !== leg) : [...cur, leg]
    )

  return (
    <ChartFrame
      label="Straddle chart"
      active={active}
      onActivate={onActivate}
      host={host}
      state={
        !expiry
          ? {
              kind: "message",
              title: "No expiry to show",
              description: "This underlying lists no upcoming expiry.",
            }
          : state.kind === "loading"
            ? { kind: "loading" }
            : state.kind === "empty"
              ? {
                  kind: "message",
                  title: "No straddle for this session",
                  description: state.note,
                }
              : undefined
      }
      toolbar={
        <>
          {pickers}
          <DropdownMenu>
            <Tip label="Session">
              <DropdownMenuTrigger asChild>
                <ToolButton aria-label="Session" className="pr-1">
                  {session === "today" ? "Today" : sessionLabel(session)}
                  <ChevronDownIcon size={12} />
                </ToolButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuRadioGroup
                value={session}
                onValueChange={setSession}
              >
                <DropdownMenuRadioItem value="today">
                  Today
                </DropdownMenuRadioItem>
                {PAST.map((d) => (
                  <DropdownMenuRadioItem key={d} value={d}>
                    {sessionLabel(d)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolDivider />
          <Tip label="Show the call leg">
            <ToolButton
              aria-label="Call leg"
              active={legs.includes("call")}
              onClick={() => toggleLeg("call")}
              aria-pressed={legs.includes("call")}
            >
              <span className="size-2 rounded-sm bg-up" aria-hidden />
              <span data-drop="5">Call</span>
            </ToolButton>
          </Tip>
          <Tip label="Show the put leg">
            <ToolButton
              aria-label="Put leg"
              active={legs.includes("put")}
              onClick={() => toggleLeg("put")}
              aria-pressed={legs.includes("put")}
            >
              <span className="size-2 rounded-sm bg-down" aria-hidden />
              <span data-drop="5">Put</span>
            </ToolButton>
          </Tip>
          {paging.kind === "loading" ? (
            <span data-drop="1" className="px-2 type-meta whitespace-nowrap">
              Loading {sessionLabel(paging.day)}
            </span>
          ) : null}
        </>
      }
      tools={<ChartTools chart={chart} fileName={`${name}-straddle.png`} />}
      header={
        !showStats ? undefined : (
          <div className="grid grid-cols-3 divide-x divide-y border-b bg-chart @2xl/chart:grid-cols-6 @2xl/chart:divide-y-0">
            <Stat
              label="Straddle"
              value={last ? fmt2(last.straddle) : "-"}
              sub={<Move change={change} pct={pct} />}
              hint="Call plus put at the strike nearest the money, and its change since the first bar"
            />
            <Stat
              label="VWAP"
              value={last?.vwap != null ? fmt2(last.vwap) : "-"}
              sub={
                last?.vwap != null
                  ? last.straddle >= last.vwap
                    ? "Straddle above"
                    : "Straddle below"
                  : undefined
              }
              hint="The straddle's volume-weighted average this session"
            />
            <Stat
              label="Strike"
              value={last ? fmt0(last.strike) : "-"}
              sub={
                last && last.atm !== last.strike
                  ? `ATM ${fmt0(last.atm)}`
                  : undefined
              }
              hint="The strike the straddle is struck at, held until the money has moved well clear of it"
            />
            {/* One leg per line: the pair on one line ran past a sixth of the frame and was cut. The synthetic future is in the chart's status line. */}
            <Stat
              label="Call"
              value={last ? fmt2(last.call) : "-"}
              sub={last ? `Put ${fmt2(last.put)}` : undefined}
              hint={
                last
                  ? `The two legs at the strike. Together they imply a synthetic future of ${fmt0(last.synth)}.`
                  : "The two legs at the strike"
              }
            />
            <Stat
              label="Implied vol"
              value={last?.iv != null ? `${last.iv.toFixed(2)}%` : "-"}
              sub={last?.vix != null ? `VIX ${last.vix.toFixed(2)}` : undefined}
            />
            <Stat
              label="Straddle / spot"
              value={
                last && last.spot
                  ? `${((last.straddle / last.spot) * 100).toFixed(2)}%`
                  : "-"
              }
              sub={
                dte !== null
                  ? dte === 0
                    ? "Expires today"
                    : `${dte}d to expiry`
                  : undefined
              }
              hint="The straddle as a share of the spot: the move priced in to expiry"
            />
          </div>
        )
      }
    />
  )
}
