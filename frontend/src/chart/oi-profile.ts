import { CHART_FONT_FAMILY, type IPrimitive, type PrimitiveHost, type PrimitiveRenderContext, type ZOrder } from "openalgo-charts"

import { MINUS, fmt0 } from "@/lib/format"

/** One strike on the price axis: both sides' open interest, its change, and delta times open interest. */
export interface Level {
  strike: number
  call: number
  put: number
  callChange: number
  putChange: number
  /** Delta x OI; the put's is negative. NaN until a forward and a vol are known. */
  callDoi: number
  putDoi: number
}

export type ProfileMode = "oi" | "change" | "delta"
export type ProfileSides = "both" | "call" | "put"
type Side = "call" | "put"

export interface ProfileOptions {
  levels: readonly Level[]
  mode: ProfileMode
  sides: ProfileSides
  callColor: string
  putColor: string
  /** Call-outs stay below this y, CSS px: the legend rows above them are text a chip must not cover. */
  chipTop?: number
}

/** Indian short scale, as a desk reads it: 1.42 Cr, 44.10 L, 8.2 K. */
export function compact(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? MINUS : ""
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(2)} L`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)} K`
  return `${sign}${fmt0(a)}`
}

/** The metric a bar measures for a side, in the mode asked. */
function valueOf(l: Level, side: Side, mode: ProfileMode): number {
  if (mode === "oi") return side === "call" ? l.call : l.put
  if (mode === "change") return side === "call" ? l.callChange : l.putChange
  return side === "call" ? l.callDoi : l.putDoi
}

const WORD: Record<ProfileMode, string> = { oi: "OI", change: "OI change", delta: "Delta × OI" }

/** Each side's bar thickness at most, CSS px. */
const BAR_H = 6
/** The longest bar, as a share of the plot's width. */
const SHARE = 0.16
const FILL_ALPHA = 0.6
const CHIP_H = 18
const CHIP_PAD = 7
const CHIP_GAP = 6
const LABEL_FONT = 11
/** Call-outs need this much plot width to have room beside the bars. */
const MIN_CHIP_PLOT = 560

interface Hit {
  left: number
  top: number
  bottom: number
  level: Level
}

interface Chip {
  text: string
  right: number
  y: number
  color: string
}

function strikeStep(levels: readonly Level[]): number {
  let step = 0
  for (let i = 1; i < levels.length; i++) {
    const d = levels[i]!.strike - levels[i - 1]!.strike
    if (d > 0 && (step === 0 || d < step)) step = d
  }
  return step
}

/** Ink that reads on a fill: dark on a light one, white on a dark one. */
function inkOn(color: string): string {
  const [r = 0, g = 0, b = 0] = (/rgba?\(([^)]+)\)/.exec(color)?.[1] ?? "").split(/[ ,/]+/).map(Number)
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.4 ? "#10131a" : "#ffffff"
}

/**
 * The OI profile on the price axis: at each strike a bar for the calls just above it and one for the
 * puts just below, hung off the right-hand axis and reaching left, their length the value's share of
 * the largest on screen. Drawn behind the candles in translucent fills so the price stays the subject.
 * The heaviest strike of each side is called out in a chip over the candles.
 *
 * Modes: open interest, its change since the last settle (shed OI is an outline), or delta times
 * open interest.
 */
export class OiProfile implements IPrimitive {
  private opts: ProfileOptions
  private host: PrimitiveHost | null = null
  private hits: Hit[] = []
  private chips: Chip[] = []
  private plotWidth = 0
  /** Where the crosshair's horizontal line runs in the price pane, CSS px, or null when it is off the pane. */
  private crosshairY: number | null = null

  /** The call-outs, painted over the candles so none cuts through a figure. */
  readonly callouts: IPrimitive = {
    zOrder: (): ZOrder => "top",
    draw: (ctx, rc) => this.drawChips(ctx, rc.dpr),
  }

  constructor(opts: ProfileOptions) {
    this.opts = opts
  }

  attached(host: PrimitiveHost): void {
    this.host = host
  }

  detached(): void {
    this.host = null
  }

  setOptions(patch: Partial<ProfileOptions>): void {
    this.opts = { ...this.opts, ...patch }
    this.host?.requestUpdate()
  }

  zOrder(): ZOrder {
    return "bottom"
  }

  /** A call-out the crosshair line runs through would be cut by it: it steps aside until the line moves on. */
  setCrosshairY(y: number | null): void {
    if (y === this.crosshairY) return
    this.crosshairY = y
    this.host?.requestUpdate()
  }

  /** The strike whose bars are under (x, y), CSS px from the price pane's top-left. */
  levelAt(x: number, y: number): Level | null {
    if (x > this.plotWidth) return null
    for (const h of this.hits) if (x >= h.left - 2 && y >= h.top - 2 && y <= h.bottom + 2) return h.level
    return null
  }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    const { levels, mode, sides, callColor, putColor } = this.opts
    this.hits = []
    this.chips = []
    this.plotWidth = rc.plotWidth
    if (levels.length === 0) return

    const shown: Side[] = sides === "both" ? ["call", "put"] : [sides]
    const dpr = rc.dpr
    const xEnd = Math.round(rc.plotWidth * dpr)
    const step = strikeStep(levels)
    const stepPx = step > 0 ? Math.abs(rc.priceScale.priceToY(levels[0]!.strike + step) - rc.priceScale.priceToY(levels[0]!.strike)) * dpr : Infinity
    // Each strike's call bar takes the upper half of its band and the put bar the lower; zoomed far
    // out the bars thin rather than run into the next strike.
    const gap = stepPx >= 16 * dpr ? Math.max(1, Math.round(dpr)) : 0
    const barH = Math.max(1, Math.min(Math.round(BAR_H * dpr), Math.floor((stepPx - 2 * gap - 1) / 2)))
    const bottom = rc.plotHeight * dpr + barH

    const onScreen = levels.filter((l) => {
      const y = rc.priceScale.priceToY(l.strike) * dpr
      return Number.isFinite(y) && y >= -barH && y <= bottom
    })
    // Scaled to the largest strike in view, not in the whole chain: a heavy strike far off screen
    // would leave every bar in view a stub against the axis.
    let max = 0
    for (const l of onScreen) for (const s of shown) max = Math.max(max, Math.abs(valueOf(l, s, mode) || 0))
    if (!(max > 0)) return
    const scale = (rc.plotWidth * SHARE * dpr) / max

    const heaviest: Record<Side, { v: number; y: number; l: Level } | null> = { call: null, put: null }
    ctx.save()
    for (const l of onScreen) {
      const y = rc.priceScale.priceToY(l.strike) * dpr
      const yCall = Math.round(y - gap - barH)
      const yPut = Math.round(y + gap)
      let reach = 0
      for (const side of shown) {
        const v = valueOf(l, side, mode)
        if (!Number.isFinite(v) || v === 0) continue
        const len = Math.round(Math.abs(v) * scale)
        if (len <= 0) continue
        reach = Math.max(reach, len)
        const top = side === "call" ? yCall : yPut
        const color = side === "call" ? callColor : putColor
        const x = xEnd - len
        if (mode === "change" && v < 0) {
          // Open interest shed since the settle: an outline, not a fill.
          ctx.globalAlpha = 0.85
          ctx.strokeStyle = color
          ctx.lineWidth = Math.max(1, Math.round(dpr))
          ctx.strokeRect(x + 0.5, top + 0.5, Math.max(0, len - 1), Math.max(0, barH - 1))
        } else {
          ctx.globalAlpha = FILL_ALPHA
          ctx.fillStyle = color
          ctx.fillRect(x, top, len, barH)
        }
        const best = heaviest[side]
        if (v > 0 || mode !== "change") if (!best || Math.abs(v) > Math.abs(best.v)) heaviest[side] = { v, y: top, l }
      }
      if (reach > 0) {
        const callOn = shown.includes("call")
        const putOn = shown.includes("put")
        this.hits.push({ left: (xEnd - reach) / dpr, top: (callOn ? yCall : yPut) / dpr, bottom: ((putOn ? yPut : yCall) + barH) / dpr, level: l })
      }
    }
    ctx.restore()

    // On a narrow plot the chips would sit on the legend and the candles: the bars alone say it.
    if (rc.plotWidth < MIN_CHIP_PLOT) return
    for (const side of shown) {
      const h = heaviest[side]
      if (!h) continue
      const len = Math.round(Math.abs(h.v) * scale)
      const sign = mode === "change" && h.v > 0 ? "+" : ""
      this.chips.push({
        text: `${side === "call" ? "Call" : "Put"} ${fmt0(h.l.strike)}  ${WORD[mode]} ${sign}${compact(mode === "delta" ? Math.abs(h.v) : h.v)}`,
        right: xEnd - len - Math.round(CHIP_GAP * dpr),
        y: h.y + barH / 2,
        color: side === "call" ? callColor : putColor,
      })
    }
  }

  private drawChips(ctx: CanvasRenderingContext2D, dpr: number): void {
    if (this.chips.length === 0) return
    const h = Math.round(CHIP_H * dpr)
    const pad = Math.round(CHIP_PAD * dpr)
    ctx.save()
    ctx.font = `500 ${Math.round(LABEL_FONT * dpr)}px ${CHART_FONT_FAMILY}`
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    const placed: { left: number; right: number; top: number }[] = []
    for (const chip of [...this.chips].sort((a, b) => a.y - b.y)) {
      const w = Math.ceil(ctx.measureText(chip.text).width) + 2 * pad
      const left = Math.max(Math.round(4 * dpr), chip.right - w)
      let top = Math.max(Math.round(chip.y - h / 2), Math.round((this.opts.chipTop ?? 0) * dpr))
      // A chip that would cover one above it steps down clear of it.
      for (const p of placed) if (left < p.right && left + w > p.left && top < p.top + h + 1 && top + h + 1 > p.top) top = p.top + h + 1
      placed.push({ left, right: left + w, top })
      if (this.crosshairY !== null && Math.abs(this.crosshairY * dpr - (top + h / 2)) <= h / 2 + 2 * dpr) continue
      ctx.fillStyle = chip.color
      ctx.beginPath()
      ctx.roundRect(left, top, w, h, Math.round(3 * dpr))
      ctx.fill()
      ctx.fillStyle = inkOn(chip.color)
      ctx.fillText(chip.text, left + pad, top + h / 2)
    }
    ctx.restore()
  }
}
