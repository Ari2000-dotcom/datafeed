import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PaneLegend, withAlpha, type Bar, type LegendValue, type PriceScaleMode, type SeriesApi, type SeriesType } from "openalgo-charts"

import { ChartFrame } from "@/chart/frame"
import { ChartTools } from "@/chart/tools"
import { AreaChartIcon, BaselineIcon, CandlesIcon, ChevronDownIcon, DeltaOiIcon, EyeOffIcon, HighLowIcon, HollowCandlesIcon, IndicatorsIcon, LineChartIcon, MoreIcon, OhlcBarsIcon, OiChangeIcon, OiTotalIcon, StepLineIcon } from "@/components/icons"
import { MenuRow, Tip, ToolButton, ToolDivider } from "@/components/app/toolbar"
import { EXCHANGE } from "@/lib/instruments"
import { INDICATORS, build, type IndicatorId, type Trace } from "@/chart/indicators"
import { OiProfile, compact, type Level, type ProfileMode, type ProfileSides } from "@/chart/oi-profile"
import { useChart } from "@/chart/use-chart"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { delta76, yearsToExpiry } from "@/lib/black76"
import { fmt0, fmt2, fmtCompact, istClock, istDate, signed, signedPct } from "@/lib/format"
import { bySession, getCandles, type Candle } from "@/lib/history"
import { inSession, sessions, tradingHours } from "@/lib/session"
import { useQuote } from "@/lib/use-hub"
import { useNow } from "@/lib/use-now"
import { useForwardIv, useOiProfile } from "@/lib/use-oi-profile"

interface IntervalSpec {
  value: string
  label: string
  /** What the hub is asked for. */
  source: string
  /** Calendar days asked: enough bars to scroll back through, under the hub's 92-day cap. */
  days: number
  seconds: number
}

const INTERVALS: readonly IntervalSpec[] = [
  { value: "1m", label: "1m", source: "1m", days: 5, seconds: 60 },
  { value: "3m", label: "3m", source: "3m", days: 10, seconds: 180 },
  { value: "5m", label: "5m", source: "5m", days: 15, seconds: 300 },
  { value: "15m", label: "15m", source: "15m", days: 30, seconds: 900 },
  { value: "30m", label: "30m", source: "30m", days: 45, seconds: 1800 },
  { value: "1h", label: "1h", source: "60m", days: 60, seconds: 3600 },
  { value: "1d", label: "1D", source: "1d", days: 90, seconds: 86_400 },
]

const INTERVAL_NAME: Record<string, string> = { "1m": "1 minute", "3m": "3 minutes", "5m": "5 minutes", "15m": "15 minutes", "30m": "30 minutes", "1h": "1 hour", "1d": "1 day" }

const KINDS: readonly { value: SeriesType; label: string; icon: () => React.ReactNode }[] = [
  { value: "candlestick", label: "Candles", icon: () => <CandlesIcon /> },
  { value: "hollow-candle", label: "Hollow candles", icon: () => <HollowCandlesIcon /> },
  { value: "bar", label: "Bars", icon: () => <OhlcBarsIcon /> },
  { value: "high-low", label: "High-low", icon: () => <HighLowIcon /> },
  { value: "line", label: "Line", icon: () => <LineChartIcon /> },
  { value: "step", label: "Step line", icon: () => <StepLineIcon /> },
  { value: "area", label: "Area", icon: () => <AreaChartIcon /> },
  { value: "baseline", label: "Baseline", icon: () => <BaselineIcon /> },
]

const MODES: readonly { value: ProfileMode | "off"; label: string; hint: string; icon: () => React.ReactNode }[] = [
  { value: "off", label: "Off", hint: "Price only", icon: () => <EyeOffIcon /> },
  { value: "oi", label: "Open interest", hint: "Each strike's call and put OI", icon: () => <OiTotalIcon /> },
  { value: "change", label: "OI change", hint: "Since the last settle; shed OI is an outline", icon: () => <OiChangeIcon /> },
  { value: "delta", label: "Delta × OI", hint: "Delta-weighted open interest, strike by strike", icon: () => <DeltaOiIcon /> },
]

const SCALES: readonly { value: PriceScaleMode; short: string; label: string; hint: string }[] = [
  { value: "linear", short: "Auto", label: "Auto", hint: "Prices on a linear scale" },
  { value: "logarithmic", short: "Log", label: "Logarithmic", hint: "Equal moves in percent look equal" },
  { value: "percentage", short: "%", label: "Percent", hint: "Change from the first visible bar" },
]

/** The range buttons under the chart, as TradingView's: each picks an interval and how many sessions are in view. */
const RANGES = [
  { label: "1D", interval: "5m", sessions: 1 },
  { label: "5D", interval: "15m", sessions: 5 },
  { label: "1M", interval: "1h", sessions: 22 },
  { label: "3M", interval: "1d", sessions: 63 },
] as const

interface Prefs {
  /** The range button in force, or null once an interval was picked by hand. */
  range: (typeof RANGES)[number]["label"] | null
  interval: string
  kind: SeriesType
  indicators: IndicatorId[]
  scale: PriceScaleMode
  profile: ProfileMode | "off"
  sides: ProfileSides
}

const DEFAULT_PREFS: Prefs = { range: null, interval: "5m", kind: "candlestick", indicators: ["volume"], scale: "linear", profile: "oi", sides: "both" }

const CANDLE_LIKE = new Set<SeriesType>(["candlestick", "hollow-candle", "bar", "high-low"])

/** The card a strike's bars open on hover: both sides' open interest, its change and the exposure. */
function StrikeCard({ level, x, y, delta }: { level: Level; x: number; y: number; delta: boolean }) {
  const row = (label: string, c: number, p: number, fmt: (v: number) => string = compact) => (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="num text-right">{Number.isFinite(c) ? fmt(c) : "-"}</span>
      <span className="num text-right">{Number.isFinite(p) ? fmt(p) : "-"}</span>
    </div>
  )
  const signedCompact = (v: number) => (v > 0 ? `+${compact(v)}` : compact(v))
  return (
    // Placed with left/top, never a transform: text on a moved layer loses its sharp edges.
    <div className="pointer-events-none absolute w-60 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md" style={{ left: Math.max(8, x - 12 - 240), top: Math.max(8, y - 44) }}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium">Strike {fmt0(level.strike)}</span>
        <span className="grid grid-cols-2 gap-x-3 text-[11px] text-subtle">
          <span className="w-14 text-right">Call</span>
          <span className="w-14 text-right">Put</span>
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {row("Open interest", level.call, level.put)}
        {row("Change", level.callChange, level.putChange, signedCompact)}
        {delta ? row("Delta × OI", level.callDoi, level.putDoi, signedCompact) : null}
      </div>
    </div>
  )
}

/**
 * The price chart. Its settings (interval, chart type, indicators, the OI view) live with whoever holds
 * the container: `stored` seeds them and `onStore` hears each change, so a saved layout keeps them.
 */
export function ScripChart({ id, name, refId, underlying, expiry, lot, active, onActivate, pickers, stored, onStore }: { id: string; name: string; refId: string | null; underlying: string; expiry: string | undefined; lot: number; active: boolean; onActivate: () => void; pickers?: React.ReactNode; stored?: Record<string, unknown>; onStore?: (prefs: Record<string, unknown>) => void }) {
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...(stored as Partial<Prefs> | undefined) }))
  const latest = useRef(prefs)
  const patch = (p: Partial<Prefs>) => {
    const next = { ...latest.current, ...p }
    latest.current = next
    setPrefs(next)
    onStore?.({ ...next })
  }
  const spec = INTERVALS.find((i) => i.value === prefs.interval) ?? INTERVALS[2]!
  const { host, chart, colors } = useChart({ minBarSpacing: 0.5 })
  const now = useNow()

  const [loaded, setLoaded] = useState<{ key: string; candles: Candle[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = `${id}|${spec.value}`
  const loading = !loaded || loaded.key !== key
  const keyRef = useRef(key)
  keyRef.current = key

  /*
   * Gap healing, as QuantDesk's chart does it. The live feed only knows the ticks after it was joined,
   * and history is the hub's answer at one moment, so bars can go missing between them: switching back
   * to an instrument within a minute (its history shared from before), a feed hiccup, a tab asleep.
   * Three things re-read history, each keeping the view and the live bar:
   *   - a live tick that starts a bar more than one interval after the last (the bars between are missing);
   *   - the first bar boundary after the chart opens, so the bar it opened in is the hub's full bar,
   *     not only the ticks seen since;
   *   - once a bar on every intraday interval while the market is open (a minute at least).
   */
  const [reloads, setReloads] = useState<{ key: string; n: number }>({ key: "", n: 0 })
  const reload = useCallback(() => setReloads((r) => ({ key: keyRef.current, n: r.key === keyRef.current ? r.n + 1 : 1 })), [])
  const refreshing = reloads.key === key && reloads.n > 0
  const reloadN = refreshing ? reloads.n : 0

  useEffect(() => {
    let cancelled = false
    if (!refreshing) setError(null)
    getCandles(id, spec.source, spec.days, false, refreshing).then(
      (candles) => !cancelled && setLoaded({ key, candles: inSession(id, candles, spec.value !== "1d") }),
      // A failed refresh leaves the chart as it was; only a first load says so.
      (e: unknown) => !cancelled && !refreshing && setError(e instanceof Error ? e.message : "Could not load candles."),
    )
    return () => {
      cancelled = true
    }
  }, [id, spec, key, reloadN]) // eslint-disable-line react-hooks/exhaustive-deps

  // Once a bar (a minute at least) on every intraday interval while the market is open and the page is in
  // view: the closed bar becomes the hub's own, and VWAP, ATP and the other indicators take it in.
  useEffect(() => {
    if (spec.seconds >= 86_400 || loading) return
    const exchange = id.startsWith("mcx:") ? "MCX" : "NSE"
    const timer = window.setInterval(() => {
      const open = sessions().find((x) => x.exchange === exchange)?.state === "open"
      if (open && document.visibilityState === "visible") reload()
    }, Math.max(60, spec.seconds) * 1000)
    return () => window.clearInterval(timer)
  }, [id, spec.seconds, loading, reload])

  // The bar boundary after the chart opens on an instrument and interval: once per key.
  const handoff = useRef<{ key: string; timer: number | null }>({ key: "", timer: null })
  useEffect(
    () => () => {
      if (handoff.current.timer !== null) window.clearTimeout(handoff.current.timer)
      handoff.current = { key: "", timer: null }
    },
    [key],
  )
  const lastGap = useRef(0)
  /** The live bar as last drawn, so a refreshed history that ends before it does not drop it. */
  const liveBar = useRef<{ key: string; bar: Bar } | null>(null)
  /** The view as it stood when the series was last torn down, so a refresh or a restyle keeps it. */
  const view = useRef<{ key: string; range: { from: number; to: number }; length: number; preset: string | null } | null>(null)

  // While a new interval loads, the old candles stay on screen.
  const candles = loaded?.candles ?? null
  /** Which instrument and interval the candles on hand are: the view and the live bar are kept per this. */
  const drawnKey = loaded?.key ?? ""
  const hasVolume = useMemo(() => (candles ?? []).some((c) => c.volume > 0), [candles])
  const price = useRef<SeriesApi | null>(null)
  const hovering = useRef(false)
  const paintLast = useRef<(() => void) | null>(null)
  const oiLegend = useRef<PaneLegend | null>(null)
  /** Where the legend rows end, CSS px: the OI call-outs sit under it. */
  const legendBottom = useRef(0)

  // --- the price and its indicators ---------------------------------------------------
  const indicatorKey = prefs.indicators.join(",")
  useEffect(() => {
    if (!chart || !colors || !candles || candles.length === 0) return
    const made: SeriesApi[] = []
    const base = { priceScaleId: "right" }
    const kind = prefs.kind
    const lineLike = kind === "line" || kind === "step" || kind === "area" || kind === "baseline"
    const mid = (Math.min(...candles.map((c) => c.low)) + Math.max(...candles.map((c) => c.high))) / 2
    const series = chart.addSeries(kind, {
      ...base,
      paneIndex: 0,
      priceFormat: { type: "custom", formatter: fmt2 },
      style: {
        upColor: colors.up,
        downColor: colors.down,
        borderUpColor: colors.up,
        borderDownColor: colors.down,
        wickUpColor: colors.up,
        wickDownColor: colors.down,
        bodyRadius: CANDLE_LIKE.has(kind) ? 1 : undefined,
        // A line's tag is in the line's colour; candles leave `color` unset so the tag follows the candle.
        color: kind === "baseline" ? undefined : lineLike ? colors.accent : undefined,
        closeColor: colors.accent,
        topColor: colors.up,
        bottomColor: colors.down,
        areaTopColor: kind === "baseline" ? withAlpha(colors.up, 0.2) : withAlpha(colors.accent, 0.24),
        areaBottomColor: kind === "baseline" ? withAlpha(colors.down, 0.2) : withAlpha(colors.accent, 0),
        baseValue: kind === "baseline" ? mid : undefined,
        lineWidth: 2,
        title: name,
        lastValueVisible: true,
        priceLineVisible: true,
      },
    })
    series.setData(candles)
    made.push(series)
    price.current = series

    const legends: PaneLegend[] = []
    const mk = (pane: number, opts: ConstructorParameters<typeof PaneLegend>[0]) => {
      const l = new PaneLegend({ font: 12, actions: [], ...opts })
      chart.addPrimitive(l, pane)
      legends.push(l)
      return l
    }
    // TradingView's status line: the name, then interval and exchange in the dimmed params, then the readings.
    const exchange = EXCHANGE[id.split(":")[0] ?? ""] ?? ""
    // TradingView's status line: the name at 14px, then O H L C and the change at 12px on the same line.
    // The name as it is written ("Nifty 50"), the interval and exchange dimmed after it, a dot for the
    // session (green while its market is open), then the readings; on a soft plate so the line reads
    // over candles that run under it.
    const venue = id.startsWith("mcx:") ? "MCX" : "NSE"
    const ohlc = mk(0, {
      id: "price",
      title: name,
      params: `${spec.label}${exchange ? ` · ${exchange}` : ""}`,
      row: 0,
      titleFont: 14,
      status: () => {
        const open = sessions().find((x) => x.exchange === venue)?.state === "open"
        return { marketStatus: { text: "●", color: open ? colors.up : withAlpha(colors.muted, 0.55) } }
      },
      statusLine: { background: true, backgroundColor: colors.ground, backgroundOpacity: 0.86 },
    })
    const groups: { legend: PaneLegend; traces: Trace[] }[] = []
    let overlayRows = 0
    for (const def of INDICATORS) {
      if (!prefs.indicators.includes(def.id) || (def.needsVolume && !hasVolume)) continue
      const paneIndex = def.place === "overlay" ? 0 : chart.panes().length
      // VWAP and ATP start at the session's opening bar; a daily chart has no time of day to anchor on.
      const built = build(def.id, candles, colors, { open: spec.seconds < 86_400 ? tradingHours(id).start : 0 })
      for (const t of built) {
        const s = chart.addSeries(t.type, {
          ...base,
          paneIndex,
          priceFormat: { type: "custom", formatter: t.key === "volume" || t.key === "macd-hist" ? fmtCompact : fmt2 },
          style: { color: t.color, lineWidth: t.width, sessionBreaks: t.sessionBreaks, title: undefined, lastValueVisible: def.place === "pane" && t.type === "line", priceLineVisible: false },
        })
        s.setData(t.points)
        made.push(s)
      }
      // A secondary pane is named at its top left, as TradingView names it; an overlay takes a row under the price's.
      const legend = mk(paneIndex, { id: def.id, title: def.title, params: def.params, color: def.place === "overlay" ? built[0]?.color : undefined, row: def.place === "overlay" ? 1 + overlayRows++ : 0 })
      groups.push({ legend, traces: built })
      if (def.place === "pane") chart.setPaneWeight(paneIndex, 1)
    }
    if (chart.panes().length > 1) chart.setPaneWeight(0, 3.2)
    const oi = mk(0, { id: "oi", title: "OI profile", row: 1 + overlayRows, visible: false })
    oiLegend.current = oi
    // The name and its readings, each overlay, the OI row: 20px apiece (the engine's legend line) from 6px down.
    legendBottom.current = 6 + (2 + overlayRows) * 20 + 4
    profile.current?.setOptions({ chipTop: legendBottom.current })
    // A live bar newer than the history's last (the hub's answer can trail the feed by a bar) stays on.
    const held = liveBar.current
    if (held && held.key === drawnKey && held.bar.time > (candles.at(-1)?.time ?? Infinity)) series.update(held.bar)
    const range = RANGES.find((r) => r.label === prefs.range)
    const kept = view.current
    if (kept && kept.key === drawnKey && kept.preset === prefs.range) {
      // Same instrument and interval (a refresh, a new chart type, an indicator): the view stays where
      // it was, moved along with new bars when it was following the live edge.
      const added = series.getData().length - kept.length
      const following = kept.range.to >= kept.length - 1
      chart.setVisibleLogicalRange(following ? { from: kept.range.from + added, to: kept.range.to + added } : kept.range)
    } else if (range) {
      // The last N sessions: from the first bar of the Nth-last one, with a few bars of air on the right.
      const days = bySession(candles)
      const first = days[Math.max(0, days.length - range.sessions)]?.candles[0]
      const from = first ? candles.findIndex((c) => c.time === first.time) : 0
      chart.setVisibleLogicalRange({ from: Math.max(0, from) - 0.5, to: candles.length + 4 })
    } else if (spec.seconds < 86_400) {
      // Intraday: open on the latest session, so each candle is drawn at a readable width instead of five
      // days of them squeezed into lines. A session just begun shows at least 120 bars; scroll left for the rest.
      const days = bySession(candles)
      const today = days.at(-1)?.candles[0]
      const start = today ? candles.findIndex((c) => c.time === today.time) : 0
      const from = Math.max(0, Math.min(start, candles.length - 120))
      chart.setVisibleLogicalRange({ from: from - 0.5, to: candles.length + 6 })
    } else chart.fitContent()

    // The readings for one bar: the price's open, high, low, close and change, each indicator's value.
    const index = new Map(candles.map((c, i) => [c.time, i]))
    const paint = (bar: Bar, i: number | undefined) => {
      const prev = i !== undefined ? candles[i - 1]?.close : candles.at(-1)?.close
      const change = prev !== undefined ? bar.close - prev : bar.close - bar.open
      const tone = change > 0 ? colors.up : change < 0 ? colors.down : colors.muted
      const values: LegendValue[] = [
        { label: "O", text: fmt2(bar.open), color: tone },
        { label: "H", text: fmt2(bar.high), color: tone },
        { label: "L", text: fmt2(bar.low), color: tone },
        { label: "C", text: fmt2(bar.close), color: tone },
        { text: `${signed(change)} (${signedPct(prev ? (change / prev) * 100 : 0)})`, color: tone },
      ]
      if (bar.volume) values.push({ label: "Vol", text: fmtCompact(bar.volume), color: colors.muted })
      ohlc.setValues(values)
      for (const g of groups) {
        const named = g.traces.length > 1
        g.legend.setValues(
          g.traces.map((t) => {
            const v = i !== undefined ? t.values[i] : t.values[t.values.length - 1]
            const text = v !== undefined && Number.isFinite(v) ? (t.key === "volume" ? fmtCompact(v) : fmt2(v)) : "-"
            return { label: named ? t.title : undefined, text, color: t.key === "volume" ? tone : t.color }
          }),
        )
      }
    }
    const lastIndex = candles.length - 1
    paintLast.current = () => {
      const bar = price.current?.getData().at(-1)
      if (bar && !hovering.current) paint(bar, bar.time === candles[lastIndex]?.time ? lastIndex : undefined)
    }
    paintLast.current()
    const off = chart.subscribeCrosshairMove((e) => {
      hovering.current = e.time !== null && e.bar !== null
      if (hovering.current && e.bar) paint(e.bar, index.get(e.bar.time))
      else paintLast.current?.()
    })
    const setupKey = drawnKey
    const setupPreset = prefs.range
    return () => {
      view.current = { key: setupKey, range: chart.getVisibleLogicalRange(), length: series.getData().length, preset: setupPreset }
      off()
      paintLast.current = null
      oiLegend.current = null
      for (const l of legends) chart.removePrimitive(l)
      for (const s of made) s.remove()
      for (let i = chart.panes().length - 1; i >= 1; i--) chart.removePane(i, { force: true })
      price.current = null
    }
  }, [chart, colors, candles, prefs.kind, prefs.range, indicatorKey, hasVolume, name, spec.label, drawnKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- the scale mode -------------------------------------------------------------------
  useEffect(() => {
    chart?.setPriceScaleOptions({ mode: prefs.scale })
  }, [chart, prefs.scale, candles])

  // --- the live tick --------------------------------------------------------------------
  const quote = useQuote(refId)
  useEffect(() => {
    const series = price.current
    if (!series || !quote || quote.replay || loading) return
    const last = series.getData().at(-1)
    if (!last) return
    const t = Math.floor(quote.ts / 1000)
    if (t < last.time) return
    const ltp = quote.ltp
    if (t < last.time + spec.seconds) {
      series.update({ ...last, high: Math.max(last.high, ltp), low: Math.min(last.low, ltp), close: ltp })
    } else if (istDate(t * 1000) === istDate(last.time * 1000)) {
      // The next bar of the same session, on the interval's own grid.
      const start = last.time + Math.floor((t - last.time) / spec.seconds) * spec.seconds
      series.update({ time: start, open: ltp, high: ltp, low: ltp, close: ltp })
      // Bars skipped between the last one and this: history has them, so ask again (at most every 30 s).
      if (start - last.time > spec.seconds && Date.now() - lastGap.current > 30_000) {
        lastGap.current = Date.now()
        reload()
      }
    }
    const drawn = series.getData().at(-1)
    if (drawn) liveBar.current = { key, bar: drawn }
    // The first tick on this chart: re-read history just after the bar it fell in closes.
    if (handoff.current.key !== key && spec.seconds < 86_400) {
      const untilNext = (spec.seconds - (t % spec.seconds)) * 1000
      handoff.current = {
        key,
        timer: window.setTimeout(() => {
          handoff.current.timer = null
          reload()
        }, untilNext + 2_000),
      }
    }
    paintLast.current?.()
  }, [quote, spec, loading, key, reload])

  // --- the OI profile -------------------------------------------------------------------
  const profileOn = prefs.profile !== "off" && !!expiry
  const { rows, at, error: oiError } = useOiProfile(underlying, expiry, profileOn)
  const fi = useForwardIv(underlying, expiry, profileOn && prefs.profile === "delta")
  const levels = useMemo<Level[]>(() => {
    if (!rows || !expiry) return []
    const t = yearsToExpiry(expiry, underlying.startsWith("mcx:"))
    return rows.map((r) => {
      const ok = fi !== null && Number.isFinite(r.call) && Number.isFinite(r.put)
      return {
        ...r,
        callDoi: ok ? delta76(fi.forward, r.strike, t, fi.iv / 100, true) * r.call : NaN,
        putDoi: ok ? delta76(fi.forward, r.strike, t, fi.iv / 100, false) * r.put : NaN,
      }
    })
  }, [rows, fi, expiry, underlying])

  const profile = useRef<OiProfile | null>(null)
  useEffect(() => {
    if (!chart || !colors) return
    const p = new OiProfile({ levels: [], mode: "oi", sides: "both", callColor: colors.oiCall, putColor: colors.oiPut })
    chart.addPrimitive(p, 0)
    chart.addPrimitive(p.callouts, 0)
    profile.current = p
    return () => {
      chart.removePrimitive(p.callouts)
      chart.removePrimitive(p)
      profile.current = null
    }
  }, [chart, colors])
  useEffect(() => {
    profile.current?.setOptions({ levels: profileOn ? levels : [], mode: prefs.profile === "off" ? "oi" : prefs.profile, sides: prefs.sides, chipTop: legendBottom.current, ...(colors ? { callColor: colors.oiCall, putColor: colors.oiPut } : {}) })
  }, [levels, profileOn, prefs.profile, prefs.sides, colors])

  const [tip, setTip] = useState<{ level: Level; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!chart) return
    return chart.subscribeCrosshairMove((e) => {
      profile.current?.setCrosshairY(e.point && e.paneIndex === 0 ? e.point.y : null)
      const level = profileOn && e.point && e.paneIndex === 0 && !e.pressed ? (profile.current?.levelAt(e.point.x, e.point.y) ?? null) : null
      setTip(level && e.point ? { level, x: e.point.x, y: e.point.y } : null)
    })
  }, [chart, profileOn])

  // --- the OI profile's legend row ------------------------------------------------------
  const mode = MODES.find((m) => m.value === prefs.profile) ?? MODES[0]!
  const waitingDelta = profileOn && prefs.profile === "delta" && fi === null
  useEffect(() => {
    const row = oiLegend.current
    if (!row || !colors) return
    row.setOptions({ visible: profileOn, params: mode.label })
    row.setValues(
      !profileOn
        ? []
        : [
            { text: "Calls", color: colors.oiCall },
            { text: "Puts", color: colors.oiPut },
            ...(at ? [{ label: "as of", text: istClock(at > 1e12 ? at : at * 1000), color: colors.muted }] : []),
            ...(waitingDelta ? [{ text: "calculating", color: colors.muted }] : []),
            ...(oiError && !rows ? [{ text: oiError, color: colors.down }] : []),
            ...(lot > 0 ? [{ label: "lot", text: fmt0(lot), color: colors.muted }] : []),
          ],
    )
  }, [profileOn, mode.label, at, waitingDelta, oiError, rows, lot, colors, candles, prefs.kind, indicatorKey])

  const toggleIndicator = (indicator: IndicatorId, on: boolean) => patch({ indicators: on ? [...prefs.indicators, indicator] : prefs.indicators.filter((i) => i !== indicator) })
  const kind = KINDS.find((k) => k.value === prefs.kind) ?? KINDS[0]!

  return (
    <ChartFrame
      label="Price chart"
      active={active}
      onActivate={onActivate}
      host={host}
      state={error && !candles ? { kind: "message", title: "Chart data unavailable", description: error } : loading && !candles ? { kind: "loading" } : candles && candles.length === 0 ? { kind: "message", title: "No prices for this period", description: "Try a different interval or date range." } : undefined}
      toolbar={
        <>
          {pickers}
          <DropdownMenu>
            <Tip label="Interval">
              <DropdownMenuTrigger asChild>
                <ToolButton aria-label="Interval" className="pr-1">
                  <span className="num">{spec.label}</span>
                  <ChevronDownIcon size={12} />
                </ToolButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuRadioGroup value={spec.value} onValueChange={(v) => patch({ interval: v, range: null })}>
                {INTERVALS.map((i) => (
                  <DropdownMenuRadioItem key={i.value} value={i.value}>
                    <span className="num">{INTERVAL_NAME[i.value]}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolDivider />

          <DropdownMenu>
            <Tip label={`Chart type: ${kind.label}`}>
              <DropdownMenuTrigger asChild>
                <ToolButton aria-label="Chart type" className="pr-1">
                  {kind.icon()}
                  <ChevronDownIcon size={12} />
                </ToolButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup value={prefs.kind} onValueChange={(v) => patch({ kind: v as SeriesType })}>
                {KINDS.map((k) => (
                  <DropdownMenuRadioItem key={k.value} value={k.value} className="min-h-9">
                    <MenuRow icon={k.icon()} label={k.label} />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <Tip label="Indicators">
              <DropdownMenuTrigger asChild>
                <ToolButton aria-label="Indicators" className="pr-1">
                  <IndicatorsIcon />
                  <span data-drop="1">
                    Indicators
                  </span>
                  {prefs.indicators.length > 0 ? <span className="num text-xs text-primary">{prefs.indicators.length}</span> : null}
                  <ChevronDownIcon size={12} />
                </ToolButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="start" className="w-60">
              {(["overlay", "pane"] as const).map((place, n) => (
                <DropdownMenuGroup key={place}>
                  {n > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuLabel>{place === "overlay" ? "On the price" : "In their own pane"}</DropdownMenuLabel>
                  {INDICATORS.filter((d) => d.place === place).map((d) => (
                    <DropdownMenuCheckboxItem key={d.id} checked={prefs.indicators.includes(d.id)} disabled={d.needsVolume && !hasVolume} onCheckedChange={(on) => toggleIndicator(d.id, on === true)} onSelect={(e) => e.preventDefault()}>
                      <MenuRow label={d.name} hint={d.needsVolume && !hasVolume ? "Needs traded volume" : undefined} />
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <Tip label={expiry ? `OI profile: ${mode.label}` : "This market has no upcoming expiry"}>
              <DropdownMenuTrigger asChild>
                <ToolButton aria-label="OI profile" disabled={!expiry} active={profileOn} className="pr-1">
                  {mode.icon()}
                  <span data-drop="1">
                    {prefs.profile === "off" ? "OI profile" : mode.label}
                  </span>
                  <ChevronDownIcon size={12} />
                </ToolButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Draw on the chart</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={prefs.profile} onValueChange={(v) => patch({ profile: v as Prefs["profile"] })}>
                  {MODES.map((m) => (
                    <DropdownMenuRadioItem key={m.value} value={m.value} className="min-h-11">
                      <MenuRow icon={m.icon()} label={m.label} hint={m.hint} />
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Strike bars</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={prefs.sides} onValueChange={(v) => patch({ sides: v as ProfileSides })}>
                  <DropdownMenuRadioItem value="both">Calls and puts</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="call">Calls only</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="put">Puts only</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {loading && candles ? (
            <span data-drop="0" className="px-2 text-xs whitespace-nowrap text-muted-foreground">
              Loading {spec.label}...
            </span>
          ) : null}
        </>
      }
      tools={
        <>
          <DropdownMenu>
            <Tip label="Price scale">
              <DropdownMenuTrigger asChild>
                <ToolButton aria-label="Price scale" data-drop="3" className="pr-1">
                  {SCALES.find((x) => x.value === prefs.scale)?.short}
                  <ChevronDownIcon size={12} />
                </ToolButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuRadioGroup value={prefs.scale} onValueChange={(v) => patch({ scale: v as PriceScaleMode })}>
                {SCALES.map((x) => (
                  <DropdownMenuRadioItem key={x.value} value={x.value} className="min-h-11">
                    <MenuRow label={x.label} hint={x.hint} />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolDivider drop={3} />
          <ChartTools chart={chart} fileName={`${name}-${spec.value}.png`} />
          {/* Shown (index.css, .chart-bar) once the price scale and the camera have given way: it keeps them. */}
          <DropdownMenu>
            <Tip label="More">
              <DropdownMenuTrigger asChild>
                <ToolButton aria-label="More" data-more="">
                  <MoreIcon />
                </ToolButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Price scale</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={prefs.scale} onValueChange={(v) => patch({ scale: v as PriceScaleMode })}>
                  {SCALES.map((x) => (
                    <DropdownMenuRadioItem key={x.value} value={x.value}>
                      {x.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => chart?.downloadScreenshot(`${name}-${spec.value}.png`)}>Save as image</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      footer={
        <>
          <ToolButton className="h-6 min-w-0 px-2 text-xs" onClick={() => chart?.runCommand("fitContent")} title="Fit every loaded bar in view">
            All
          </ToolButton>
          {RANGES.map((r) => (
            <ToolButton key={r.label} active={prefs.range === r.label} className="h-6 min-w-0 px-2 text-xs" onClick={() => patch({ interval: r.interval, range: r.label })} title={`${r.label}: ${r.interval} bars`}>
              {r.label}
            </ToolButton>
          ))}
          <span className="num ml-auto pr-1 text-muted-foreground">{istClock(now)} UTC+5:30</span>
        </>
      }
    >
      {tip ? <StrikeCard level={tip.level} x={tip.x} y={tip.y} delta={prefs.profile === "delta"} /> : null}
    </ChartFrame>
  )
}
