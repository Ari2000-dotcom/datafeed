import { useSyncExternalStore } from "react"
import { CHART_FONT_FAMILY, darkTheme, lightTheme, type ChartTheme } from "openalgo-charts"

/**
 * The chart engine paints on a canvas and cannot read `var(--x)`, and its colour maths wants
 * rgb. Each token is resolved through the browser (`oklch` and all) and read back as rgb.
 */
let probe: CanvasRenderingContext2D | null = null

export function cssColor(token: string): string {
  const el = document.createElement("span")
  el.style.color = `var(${token})`
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  el.remove()
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!probe) return computed
  probe.canvas.width = probe.canvas.height = 1
  probe.fillStyle = "#000"
  probe.fillStyle = computed
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${((a ?? 0) / 255).toFixed(3)})`
}

export interface Palette {
  ground: string
  grid: string
  text: string
  muted: string
  /** The status line's names and labels. */
  legend: string
  /** The chart's name in its status line. */
  legendTitle: string
  subtle: string
  axis: string
  border: string
  surface: string
  accent: string
  up: string
  down: string
  oiCall: string
  oiPut: string
}

/** The chart's own colours (the --chart-* tokens: QuantDesk's canvas, text, candles and OI bars), not the page's. */
export function palette(): Palette {
  return {
    ground: cssColor("--chart"),
    grid: cssColor("--chart-grid"),
    text: cssColor("--chart-text"),
    muted: cssColor("--chart-muted"),
    legend: cssColor("--chart-legend"),
    legendTitle: cssColor("--chart-legend-title"),
    subtle: cssColor("--chart-muted"),
    axis: cssColor("--chart-axis"),
    border: cssColor("--chart-border"),
    surface: cssColor("--chart-surface"),
    accent: cssColor("--chart-accent"),
    up: cssColor("--chart-up"),
    down: cssColor("--chart-down"),
    oiCall: cssColor("--chart-oi-call"),
    oiPut: cssColor("--chart-oi-put"),
  }
}

/** The engine's own theme for this scheme, set on the page's palette: charts sit on the card colour, so they read as part of it. */
export function chartTheme(p: Palette): ChartTheme {
  const base = document.documentElement.classList.contains("light") ? lightTheme : darkTheme
  return {
    ...base,
    background: p.ground,
    grid: p.grid,
    axisText: p.axis,
    legendText: p.text,
    // The chart's name in its status line: TradingView's soft grey, not the bright value white.
    legendTitle: p.legendTitle,
    legendDim: p.legend,
    axisLine: p.border,
    paneSeparator: p.border,
    crosshair: p.subtle,
    crosshairStyle: "dashed",
    crosshairLabelBackground: p.surface,
    axisFontSize: 12,
    lastPriceText: p.ground,
  }
}

/** Each price axis's width: the widest value it will show, in the axis's own type, with room either side. */
export function priceAxisWidth(): number {
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return 76
  ctx.font = `12px ${CHART_FONT_FAMILY}`
  return Math.ceil(ctx.measureText("88,888.88").width) + 16
}

function subscribeScheme(fn: () => void): () => void {
  const observer = new MutationObserver(fn)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

/** "dark" or "light": what the page is showing now, so a chart can be rebuilt in the new palette. */
export function useScheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeScheme, () => (document.documentElement.classList.contains("light") ? "light" : "dark"))
}
