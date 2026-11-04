/**
 * The part of the charting engine this app uses (vendor/openalgo-charts, aliased in vite.config.ts).
 * The engine is type-checked under its own strict settings in its own folder; the app sees this
 * narrow surface so a change inside the engine cannot break the app's build.
 */

export interface Bar {
  /** UTC seconds. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface LinePoint {
  time: number
  value: number
  /** A colour for this one bar. */
  color?: string
}

/** A gap in a line: a time with no value. */
export interface Whitespace {
  time: number
}

export type SeriesType = "candlestick" | "hollow-candle" | "bar" | "high-low" | "line" | "area" | "baseline" | "column" | "histogram" | "step"

export interface SeriesApi {
  setData(data: readonly (Bar | LinePoint | Whitespace)[]): void
  /** Earlier points put in front; the bars in view stay in view. */
  prependData(data: readonly (Bar | LinePoint | Whitespace)[]): void
  update(item: Bar | LinePoint | Whitespace): void
  getData(): Bar[]
  applyOptions(style: Record<string, unknown>): void
  remove(): void
  /** The scale this series reads on: pinned to a range, or back to fitting what is in view with null. */
  priceScale(): {
    setFixedRange(range: { min: number; max: number } | null): void
    setOptions(options: { marginTop?: number; marginBottom?: number }): void
  }
}

export interface CrosshairMoveEvent {
  /** UTC seconds of the hovered bar, or null off the data. */
  time: number | null
  index: number | null
  price: number | null
  /** Hovered bar of the first price series. */
  bar: Bar | null
  point: { x: number; y: number } | null
  paneIndex?: number | null
  pressed?: boolean
}

export type ZOrder = "bottom" | "normal" | "top"

export interface PrimitiveHost {
  requestUpdate(): void
}

export interface PrimitiveRenderContext {
  /** Device pixels per CSS pixel. */
  dpr: number
  /** The plot's size, CSS px. */
  plotWidth: number
  plotHeight: number
  priceScale: { priceToY(price: number): number }
  timeScale: { indexToX(index: number): number }
  dataLayer: { timeToIndexFloat(time: number): number }
}

/** Something drawn on a pane's canvas, over or under the series. */
export interface IPrimitive {
  zOrder(): ZOrder
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void
  attached?(host: PrimitiveHost): void
  detached?(): void
}

export type PriceScaleMode = "linear" | "logarithmic" | "percentage" | "indexed-to-100"

export interface Chart {
  addSeries(type: SeriesType, options?: Record<string, unknown>): SeriesApi
  fitContent(): void
  /** The bars in view, as logical indexes (a bar is one unit; the last bar is `length - 1`). */
  setVisibleLogicalRange(range: { from: number; to: number }): void
  getVisibleLogicalRange(): { from: number; to: number }
  setTheme(theme: ChartTheme): void
  /** A pan or zoom of the view. */
  on(event: "pan" | "zoom", fn: () => void): () => void
  destroy(): void
  subscribeCrosshairMove(fn: (event: CrosshairMoveEvent) => void): () => void
  panes(): unknown[]
  setPaneWeight(index: number, weight: number): void
  removePane(index: number, options?: { force?: boolean }): void
  addPrimitive(primitive: IPrimitive, paneIndex?: number): void
  removePrimitive(primitive: IPrimitive): void
  /** A horizontal level across the plot with its own axis tag, as a reference line. */
  addPriceLine(options: { id: string; price: number; color: string; lineWidth?: number; lineStyle?: "solid" | "dashed" | "dotted"; label?: string }, paneIndex?: number): IPrimitive
  setPriceScaleOptions(patch: { mode?: PriceScaleMode }, scope?: "primary" | "axes" | "all"): void
  /** A built-in command, as its keyboard shortcut runs it: zoomIn, zoomOut, resetScale, fitContent. */
  runCommand(command: string): boolean
  downloadScreenshot(filename?: string): void
  /** Called when a pan nears the oldest bar; re-armed by `historyLoadComplete`. */
  setHistoryLoader(loader: () => void): void
  historyLoadComplete(): void
}

export function ema(values: readonly number[], period: number): number[]
export function rsi(values: readonly number[], period?: number): number[]
export function atr(high: readonly number[], low: readonly number[], close: readonly number[], period?: number): number[]
export function supertrend(bars: readonly Bar[], period?: number, multiplier?: number): { value: number; direction: 1 | -1 }[]

export interface ChartTheme {
  background: string
  grid: string
  axisText: string
  axisLine: string
  paneSeparator: string
  crosshair: string
  crosshairStyle?: "dashed" | "solid" | "dotted"
  crosshairLabelBackground?: string
  axisFontSize?: number
  lastPriceText?: string
  [key: string]: unknown
}

export const CHART_FONT_FAMILY: string
export const darkTheme: ChartTheme
export const lightTheme: ChartTheme
export function createChart(element: HTMLElement, options?: Record<string, unknown>): Chart
export function withAlpha(color: string, alpha: number): string

export interface LegendValue {
  /** A dimmed prefix: O, H, L, C, Vol. */
  label?: string
  text: string
  color?: string
}

export type PaneLegendAction = "hide" | "settings" | "source" | "up" | "down" | "collapse" | "maximize" | "close"

export interface PaneLegendOptions {
  /** Stable id. */
  id: string
  /** The source's name, in bold. */
  title: string
  /** Dimmed parameters after the name: `14 close`. */
  params?: string
  /** A swatch before the name; none when omitted. */
  color?: string
  /** The slot on the pane, 0 at the top. */
  row?: number
  /** Which inline buttons to draw; none for `[]`. */
  actions?: readonly PaneLegendAction[]
  /** False removes the row. */
  visible?: boolean
  /** Switches for the row's parts; `title: false` leaves only the readings. */
  statusLine?: {
    title?: boolean
    marketStatus?: boolean
    /** A plate behind the row so it reads over candles. */
    background?: boolean
    backgroundOpacity?: number
    backgroundColor?: string
  }
  /** What the host knows and the engine does not: the session's state, read each frame. */
  status?:
    | { marketStatus?: LegendValue }
    | (() => { marketStatus?: LegendValue } | null)
  /** Text size in px. */
  font?: number
  /** The name's size when it is larger than the readings on its line (TradingView: 16 over 13). */
  titleFont?: number
}

/** The row at a pane's top left: swatch, name, parameters, then the readings. Drawn on the canvas, as TradingView draws its status line. */
export class PaneLegend implements IPrimitive {
  constructor(options: PaneLegendOptions)
  setValues(values: readonly LegendValue[]): void
  setOptions(patch: Partial<PaneLegendOptions>): void
  zOrder(): ZOrder
  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void
}
