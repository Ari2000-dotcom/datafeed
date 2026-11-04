import { atr, ema, rsi, supertrend, type Bar, type LinePoint, type Whitespace } from "openalgo-charts"

import { istDate, istParts } from "@/lib/format"
import type { Palette } from "@/chart/theme"

export type IndicatorId = "volume" | "sma20" | "ema20" | "ema50" | "vwap" | "atp" | "bb" | "supertrend" | "rsi" | "macd" | "atr"

export interface IndicatorDef {
  id: IndicatorId
  /** The menu's name. */
  name: string
  /** The legend's: the source, then its parameters dimmed. */
  title: string
  params: string
  /** Drawn over the price (overlay) or in a pane of its own below it. */
  place: "overlay" | "pane"
  /** Needs traded volume, which an index does not have. */
  needsVolume?: boolean
}

export const INDICATORS: readonly IndicatorDef[] = [
  { id: "sma20", name: "SMA 20", title: "SMA", params: "20 close", place: "overlay" },
  { id: "ema20", name: "EMA 20", title: "EMA", params: "20 close", place: "overlay" },
  { id: "ema50", name: "EMA 50", title: "EMA", params: "50 close", place: "overlay" },
  { id: "vwap", name: "VWAP", title: "VWAP", params: "from the open", place: "overlay", needsVolume: true },
  { id: "atp", name: "ATP (average traded price)", title: "ATP", params: "from the open", place: "overlay" },
  { id: "bb", name: "Bollinger Bands 20, 2", title: "Bollinger Bands", params: "20 2", place: "overlay" },
  { id: "supertrend", name: "Supertrend 10, 3", title: "Supertrend", params: "10 3", place: "overlay" },
  { id: "volume", name: "Volume", title: "Volume", params: "", place: "pane", needsVolume: true },
  { id: "rsi", name: "RSI 14", title: "RSI", params: "14 close", place: "pane" },
  { id: "macd", name: "MACD 12, 26, 9", title: "MACD", params: "12 26 9", place: "pane" },
  { id: "atr", name: "ATR 14", title: "ATR", params: "14", place: "pane" },
]

/** One line or histogram an indicator draws. */
export interface Trace {
  key: string
  title: string
  type: "line" | "histogram"
  color: string
  width: number
  points: (LinePoint | Whitespace)[]
  /** A legend reads these by bar index. */
  values: number[]
  /** Starts afresh each session: the line is broken at each day's opening bar, not joined across the night. */
  sessionBreaks?: boolean
}

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v)

function trace(bars: readonly Bar[], key: string, title: string, color: string, values: number[], width = 1.5, type: Trace["type"] = "line"): Trace {
  return { key, title, type, color, width, values, points: bars.map((b, i) => (finite(values[i]) ? { time: b.time, value: values[i]! } : { time: b.time })) }
}

function sma(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!
    if (i >= period) sum -= values[i - period]!
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** EMA that starts only once `period` bars exist, as a chart's reads: the seeding bars are not a signal. */
function emaFrom(values: readonly number[], period: number): number[] {
  return ema(values, period).map((v, i) => (i >= period - 1 ? v : NaN))
}

/**
 * A running average over each session, anchored at its opening bar (09:15 IST on NSE and BSE, 09:00
 * on MCX) and restarted every day; bars before the open are left blank. `weight` says how much each
 * bar's typical price (high + low + close) / 3 counts: its volume for VWAP, one apiece for ATP.
 */
function anchored(bars: readonly Bar[], open: number, weight: (b: Bar) => number): number[] {
  const out: number[] = []
  let day = ""
  let pv = 0
  let w = 0
  for (const b of bars) {
    const ms = b.time * 1000
    const d = istDate(ms)
    if (d !== day) {
      day = d
      pv = 0
      w = 0
    }
    // Daily bars have no time of day and pass whole.
    if (istParts(ms).minutes < open && open > 0) {
      out.push(NaN)
      continue
    }
    const k = weight(b)
    pv += ((b.high + b.low + b.close) / 3) * k
    w += k
    out.push(w > 0 ? pv / w : NaN)
  }
  return out
}

/** Session VWAP from the open: typical price weighted by volume. */
const vwap = (bars: readonly Bar[], open: number) => anchored(bars, open, (b) => b.volume ?? 0)

/**
 * ATP, the average traded price from the open: every bar's typical price counted equally, so it
 * reads the same with or without volume (an index has none of its own).
 */
const atp = (bars: readonly Bar[], open: number) => anchored(bars, open, () => 1)

export interface BuildOptions {
  /** The session's opening minute, IST (555 = 09:15); 0 for daily bars. */
  open?: number
}

/** Builds the traces an indicator draws, over `bars`, in the palette's colours. */
export function build(id: IndicatorId, bars: readonly Bar[], p: Palette, o: BuildOptions = {}): Trace[] {
  const close = bars.map((b) => b.close)
  const open = o.open ?? 0
  switch (id) {
    case "sma20":
      return [trace(bars, "sma20", "SMA 20", p.accent, sma(close, 20))]
    case "ema20":
      return [trace(bars, "ema20", "EMA 20", cssAmber(), emaFrom(close, 20))]
    case "ema50":
      return [trace(bars, "ema50", "EMA 50", p.text, emaFrom(close, 50))]
    case "vwap":
      return [{ ...trace(bars, "vwap", "VWAP", cssViolet(), vwap(bars, open), 1.5), sessionBreaks: true }]
    case "atp":
      return [{ ...trace(bars, "atp", "ATP", cssSky(), atp(bars, open), 1.5), sessionBreaks: true }]
    case "bb": {
      const mid = sma(close, 20)
      const dev = close.map((_, i) => {
        if (!finite(mid[i])) return NaN
        let s = 0
        for (let k = i - 19; k <= i; k++) s += (close[k]! - mid[i]!) ** 2
        return Math.sqrt(s / 20)
      })
      return [
        trace(bars, "bb-up", "BB upper", p.accent, mid.map((m, i) => m + 2 * dev[i]!), 1),
        trace(bars, "bb-mid", "BB basis", p.muted, mid, 1),
        trace(bars, "bb-lo", "BB lower", p.accent, mid.map((m, i) => m - 2 * dev[i]!), 1),
      ]
    }
    case "supertrend": {
      const st = supertrend(bars, 10, 3)
      const t = trace(bars, "supertrend", "Supertrend", p.up, st.map((s) => s.value), 2)
      // One line, each bar in the colour of the side it is on.
      t.points = bars.map((b, i) => (finite(st[i]!.value) ? { time: b.time, value: st[i]!.value, color: st[i]!.direction === 1 ? p.up : p.down } : { time: b.time }))
      return [t]
    }
    case "volume": {
      const t = trace(bars, "volume", "Volume", p.muted, bars.map((b) => b.volume ?? NaN), 1, "histogram")
      t.points = bars.map((b) => ({ time: b.time, value: b.volume ?? 0, color: b.close >= b.open ? withAlphaRgb(p.up, 0.55) : withAlphaRgb(p.down, 0.55) }))
      return [t]
    }
    case "rsi":
      return [trace(bars, "rsi", "RSI 14", cssViolet(), rsi(close, 14), 1.5)]
    case "macd": {
      const fast = emaFrom(close, 12)
      const slow = emaFrom(close, 26)
      const line = close.map((_, i) => (finite(fast[i]) && finite(slow[i]) ? fast[i]! - slow[i]! : NaN))
      const first = line.findIndex(finite)
      const sig = first < 0 ? [] : [...new Array<number>(first).fill(NaN), ...emaFrom(line.slice(first), 9)]
      const hist = line.map((v, i) => (finite(v) && finite(sig[i]) ? v - sig[i]! : NaN))
      const h = trace(bars, "macd-hist", "Histogram", p.muted, hist, 1, "histogram")
      h.points = bars.map((b, i) => (finite(hist[i]) ? { time: b.time, value: hist[i]!, color: withAlphaRgb(hist[i]! >= 0 ? p.up : p.down, 0.6) } : { time: b.time }))
      return [h, trace(bars, "macd", "MACD", p.accent, line), trace(bars, "macd-sig", "Signal", cssAmber(), sig)]
    }
    case "atr":
      return [trace(bars, "atr", "ATR 14", cssAmber(), atr(bars.map((b) => b.high), bars.map((b) => b.low), close, 14))]
  }
}

/** Two more hues for lines that must tell apart from the accent, fixed so a chart reads the same in dark and light. */
const cssAmber = () => "rgb(217, 164, 65)"
const cssViolet = () => "rgb(160, 130, 224)"
const cssSky = () => "rgb(86, 180, 233)"

/** `rgb(r, g, b)` at an alpha, for the colours `cssColor` returns. */
export function withAlphaRgb(color: string, alpha: number): string {
  const m = /rgba?\(([^)]+)\)/.exec(color)
  if (!m) return color
  const [r, g, b] = m[1]!.split(/[ ,/]+/).map(Number)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
