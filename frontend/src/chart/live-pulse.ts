import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext, ZOrder } from "openalgo-charts"

/** The live end of a line: where it ends, in what colour, and whether the feed is still sending. */
export interface PulseDot {
  /** Epoch seconds of the minute the line ends on. */
  time: number
  value: number
  colour: string
  /** Rings drizzle out only while it is live; a closed market keeps the dot still. */
  live: boolean
}

/** Dot radius, and how far a ring spreads before it is gone, CSS px. */
const DOT_R = 3.5
const RING_R = 14
/** One ring's life, ms, and how many follow each other. */
const RING_MS = 2200
const RINGS = 2
/** Repaint at about 22 fps: a ring does not need more, and the chart is redrawn each time. */
const FRAME_MS = 45

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * The live end of a line, TradingView's way: a solid dot on the latest value with soft rings
 * drizzling out from it and fading, so the eye finds where the session is right now. Drawn over the
 * lines, repainting itself while the dot is live, and still for a viewer who asks for reduced motion.
 */
export class LivePulse implements IPrimitive {
  private host: PrimitiveHost | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly read: () => PulseDot | null

  constructor(read: () => PulseDot | null) {
    this.read = read
  }

  attached(host: PrimitiveHost): void {
    this.host = host
    this.tick()
  }

  detached(): void {
    this.host = null
    clearTimeout(this.timer)
  }

  zOrder(): ZOrder {
    return "top"
  }

  private tick = () => {
    if (!this.host) return
    this.host.requestUpdate()
    if (!reduced() && this.read()?.live) this.timer = setTimeout(this.tick, FRAME_MS)
    else this.timer = setTimeout(this.tick, 1500)
  }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    const dot = this.read()
    if (!dot) return
    const d = rc.dpr
    const x = rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(dot.time)) * d
    const y = rc.priceScale.priceToY(dot.value) * d
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > rc.plotWidth * d || y < 0 || y > rc.plotHeight * d) return
    ctx.save()
    ctx.strokeStyle = dot.colour
    ctx.fillStyle = dot.colour
    if (dot.live && !reduced()) {
      const now = performance.now()
      for (let i = 0; i < RINGS; i++) {
        // Each ring starts a share of its life after the last; the spread eases out.
        const t = ((now + (i * RING_MS) / RINGS) % RING_MS) / RING_MS
        const eased = 1 - (1 - t) * (1 - t)
        ctx.globalAlpha = 0.5 * (1 - t)
        ctx.lineWidth = Math.max(1, (1.6 - t) * d)
        ctx.beginPath()
        ctx.arc(x, y, (DOT_R + (RING_R - DOT_R) * eased) * d, 0, Math.PI * 2)
        ctx.stroke()
      }
      // A soft halo that breathes under the dot.
      ctx.globalAlpha = 0.14 + 0.1 * Math.sin(now / 420)
      ctx.beginPath()
      ctx.arc(x, y, (DOT_R + 3) * d, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(x, y, DOT_R * d, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}
