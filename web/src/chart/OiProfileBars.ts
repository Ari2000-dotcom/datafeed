import { CHART_FONT_FAMILY, type IPrimitive, type PrimitiveHost, type PrimitiveRenderContext, type ZOrder } from "openalgo-charts";

import { fmt0 } from "../core/format";

/**
 * The OI profile on the price axis, QuantDesk's way (chart/candle/engine.ts there, "Bars hung off
 * the price axis at fixed prices"): each strike gets one bar just above it (call OI) and one just
 * below (put OI), reaching left from the right axis, their length the value's share of the
 * largest on screen.
 *
 * - `oi`: total open interest, solid.
 * - `change`: today's change alone; a negative value (OI shed) draws hollow.
 * - `both`: total OI dimmed, with today's addition highlighted solid at its outer end, and OI shed
 *   today as an outline beyond it (where the bar stood at yesterday's close). The strikes that
 *   added the most call and put OI are named beside their bars.
 *
 * The largest strike on screen sets the scale, so the profile reads at full length wherever the
 * chart is scrolled, as TradingView's visible-range volume profile does; the fills are translucent
 * and drawn behind the candles (`zOrder: "bottom"`), so the price action stays legible over it. A
 * bar is never thicker than its strike's share of the height allows, so neighbouring strikes never
 * run into each other however far the price scale is zoomed out.
 *
 * Its figures are call-outs in the chart's own tag shape (the axis's name boxes: the series'
 * colour, a 16px box rounded an eighth of its height), drawn over the candles by a companion
 * primitive (`callouts`) so a candle never cuts through one; two that would overlap step apart.
 */
export interface OiBarLevel {
  price: number;
  /** NaN = no reading yet. */
  call: number;
  put: number;
  /** Today's change (`oi - poi`); NaN = unknown. Read in `change` and `both`. */
  callChange: number;
  putChange: number;
}

export type OiBarsMode = "oi" | "change" | "both";

export interface OiProfileBarsOptions {
  levels: readonly OiBarLevel[];
  mode: OiBarsMode;
  callColor: string;
  putColor: string;
  /** The longest bar, as a share of the plot's width. */
  share?: number;
  /** What the bars measure: open interest, or delta x OI (then the heaviest strikes are called out). */
  unit?: "oi" | "delta";
  /** Which side to draw: both, or one alone (it then sets the scale and the call-outs by itself). */
  sides?: "both" | "call" | "put";
}

/** Delta x OI: a strike is heavy when it holds this share of its side's largest, the top few only. */
const HEAVY_SHARE = 0.55;
const HEAVY_MAX = 3;
/** Once heavy, a strike stays so down to this share. */
const HEAVY_KEEP = 0.45;
/** A heavy strike's bar, against the others' dimmer one. */
const HEAVY_ALPHA = 0.85;
const DELTA_TOTAL_ALPHA = 0.28;

/** Indian short scale, as a desk reads it: 1.42 Cr, 44.1 L, 8.2 K. */
function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(1)} K`;
  return fmt0(a);
}

/** Each side's bar thickness at most, CSS px. */
const BAR_H = 6;
/** Gap between the call bar (above) and the put bar (below) at a strike, CSS px. */
const GAP = 1;
/** The longest bar's share of the plot: room is left beside the heavy strikes for their figures. */
const DEFAULT_SHARE = 0.35;
/** How strongly total OI shows under today's highlighted change in `both`. */
const TOTAL_ALPHA = 0.35;
const LABEL_FONT = 11;
/** Today's change in `both`: a little under full strength, washed with grey, so it marks the bar
 *  without shouting over the candles. */
const CHANGE_ALPHA = 0.8;
const CHANGE_GREY = "rgba(120, 123, 134, 0.35)";
/** How far outside a bar the pointer still counts as on it, CSS px. */
const HIT_SLOP = 2;
/** A filled bar's opacity, and a hollow one's outline: the candles over them stay the subject. */
const FILL_ALPHA = 0.5;
const STROKE_ALPHA = 0.8;
/** Below this many device px per strike, a strike's call and put bars meet at the strike. */
const ROOMY_STRIKE = 16;
/** A call-out's box: the axis tags' height and side padding, CSS px, and its gap from its bar. */
const CHIP_H = 16;
const CHIP_PAD = 6;
const CHIP_GAP = 6;

/** A call-out, device px: its text, its box's right edge and centre line, its colour. */
interface Chip {
  text: string;
  right: number;
  y: number;
  color: string;
}

/** Dark ink on a light fill, white on a dark one, as the axis tags choose. */
function inkOn(color: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  const rgb = hex
    ? [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16))
    : (/rgba?\(([^)]+)\)/.exec(color)?.[1] ?? "").split(/[ ,/]+/).slice(0, 3).map(Number);
  if (rgb.length < 3 || rgb.some((v) => !Number.isFinite(v))) return "#ffffff";
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(rgb[0]!) + 0.7152 * lin(rgb[1]!) + 0.0722 * lin(rgb[2]!);
  return lum > 0.45 ? "#10131a" : "#ffffff";
}

/** The smallest step between two neighbouring strikes, or 0 for fewer than two. */
function strikeStep(levels: readonly OiBarLevel[]): number {
  const prices = levels.map((l) => l.price).sort((a, b) => a - b);
  let step = 0;
  for (let i = 1; i < prices.length; i++) {
    const d = prices[i]! - prices[i - 1]!;
    if (d > 0 && (step === 0 || d < step)) step = d;
  }
  return step;
}

/** A drawn bar, CSS px from the pane's top-left: what `levelAt` finds under the pointer. */
interface Hit {
  left: number;
  top: number;
  bottom: number;
  level: OiBarLevel;
}

type Side = "call" | "put";

const total = (level: OiBarLevel, side: Side) => (side === "call" ? level.call : level.put);
const change = (level: OiBarLevel, side: Side) => (side === "call" ? level.callChange : level.putChange);

/** How far one side's bar reaches, in the units it is scaled by, for `mode`. */
function extent(level: OiBarLevel, side: Side, mode: OiBarsMode): number {
  const t = total(level, side);
  const c = change(level, side);
  if (mode === "oi") return Math.abs(t);
  if (mode === "change") return Math.abs(c);
  // OI shed today draws beyond the total, out to yesterday's level.
  return Number.isFinite(c) && c < 0 ? t - c : t;
}

export class OiProfileBars implements IPrimitive {
  private opts: OiProfileBarsOptions;
  private host: PrimitiveHost | null = null;
  private hits: Hit[] = [];
  private plotWidth = 0;
  /** The call-outs the last `draw` placed, for `callouts` to paint over the candles. */
  private chips: Chip[] = [];

  /** The profile's figures, over the candles: add it to the same pane, after the bars. */
  readonly callouts: IPrimitive = {
    zOrder: () => "top",
    draw: (ctx, rc) => this.drawChips(ctx, rc.dpr),
  };

  constructor(opts: OiProfileBarsOptions) {
    this.opts = opts;
  }

  attached(host: PrimitiveHost): void {
    this.host = host;
  }

  detached(): void {
    this.host = null;
  }

  /** Restyle or re-level in place; repaints. */
  setOptions(patch: Partial<OiProfileBarsOptions>): void {
    this.opts = { ...this.opts, ...patch };
    this.host?.requestUpdate();
  }

  /** The strike whose bar is under (x, y), CSS px from the price pane's top-left; null off them. */
  levelAt(x: number, y: number): OiBarLevel | null {
    if (x > this.plotWidth) return null;
    for (const h of this.hits) {
      if (x >= h.left - HIT_SLOP && y >= h.top - HIT_SLOP && y <= h.bottom + HIT_SLOP) return h.level;
    }
    return null;
  }

  zOrder(): ZOrder {
    return "bottom";
  }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    const { levels, mode, callColor, putColor, share = DEFAULT_SHARE, unit = "oi", sides = "both" } = this.opts;
    const shown: Side[] = sides === "both" ? ["call", "put"] : [sides];
    const calls = sides !== "put";
    const puts = sides !== "call";
    this.hits = [];
    this.chips = [];
    this.plotWidth = rc.plotWidth;
    if (levels.length === 0) return;

    const dpr = rc.dpr;
    const xEnd = Math.round(rc.plotWidth * dpr);
    // A strike's band is the height between it and the next: its call bar takes the upper half and
    // its put bar the lower, with a device pixel left clear between one strike's and the next's.
    // Zoomed out, the two halves meet at the strike rather than thin to a hairline.
    const step = strikeStep(levels);
    const stepPx = step > 0 ? Math.abs(rc.priceScale.priceToY(levels[0]!.price + step) - rc.priceScale.priceToY(levels[0]!.price)) * dpr : Infinity;
    const gap = stepPx >= ROOMY_STRIKE * dpr ? Math.max(1, Math.round(GAP * dpr)) : 0;
    const barH = Math.max(1, Math.min(Math.round(BAR_H * dpr), Math.floor((stepPx - 2 * gap - 1) / 2)));
    const bottom = rc.plotHeight * dpr + barH;
    // Scaled to the largest strike on screen, not in the whole chain: a heavy strike far off the
    // view left every bar in it a stub against the price axis.
    const onScreen = levels.filter((level) => {
      const y = rc.priceScale.priceToY(level.price) * dpr;
      return Number.isFinite(y) && y >= -barH && y <= bottom;
    });
    const max = this.largest(onScreen, mode, shown);
    if (max <= 0) return;
    const scale = (rc.plotWidth * share * dpr) / max;

    const heavy = unit === "delta" ? this.heaviest(levels, shown) : null;
    // The strikes that added the most today, for `both`'s labels: only among those on screen.
    let topCall: { level: OiBarLevel; y: number } | null = null;
    let topPut: { level: OiBarLevel; y: number } | null = null;

    ctx.save();
    for (const level of levels) {
      const y = rc.priceScale.priceToY(level.price) * dpr;
      if (!Number.isFinite(y) || y < -barH || y > bottom) continue;
      const yCall = Math.round(y - gap - barH);
      const yPut = Math.round(y + gap);
      const reach = Math.max(...shown.map((side) => extent(level, side, mode)));
      if (Number.isFinite(reach) && reach > 0) {
        this.hits.push({
          left: (xEnd - reach * scale) / dpr,
          // One side alone: the hit is that side's bar, not the pair's band.
          top: (calls ? yCall : yPut) / dpr,
          bottom: ((puts ? yPut : yCall) + barH) / dpr,
          level,
        });
      }
      if (mode === "both" && heavy) {
        const hc = calls && heavy.call.has(level.price);
        const hp = puts && heavy.put.has(level.price);
        if (calls) this.layered(ctx, xEnd, yCall, barH, scale, level, "call", callColor, hc ? HEAVY_ALPHA : DELTA_TOTAL_ALPHA);
        if (puts) this.layered(ctx, xEnd, yPut, barH, scale, level, "put", putColor, hp ? HEAVY_ALPHA : DELTA_TOTAL_ALPHA);
        if (hc) this.heavyMark(ctx, xEnd, yCall, barH, scale, level, "call", callColor, dpr);
        if (hp) this.heavyMark(ctx, xEnd, yPut, barH, scale, level, "put", putColor, dpr);
      } else if (mode === "both") {
        if (calls) this.layered(ctx, xEnd, yCall, barH, scale, level, "call", callColor);
        if (puts) this.layered(ctx, xEnd, yPut, barH, scale, level, "put", putColor);
        if (calls && level.callChange > 0 && (!topCall || level.callChange > topCall.level.callChange)) topCall = { level, y: yCall };
        if (puts && level.putChange > 0 && (!topPut || level.putChange > topPut.level.putChange)) topPut = { level, y: yPut };
      } else {
        const pick = mode === "oi" ? total : change;
        if (calls) this.bar(ctx, xEnd, yCall, barH, scale, pick(level, "call"), callColor);
        if (puts) this.bar(ctx, xEnd, yPut, barH, scale, pick(level, "put"), putColor);
      }
    }

    if (topCall) this.label(xEnd, topCall.y, barH, scale, topCall.level, "call", callColor, dpr);
    if (topPut) this.label(xEnd, topPut.y, barH, scale, topPut.level, "put", putColor, dpr);
    ctx.restore();
  }

  /** The strikes kept as heavy, per side, so a strike at the line does not flip bright and dim. */
  private kept: { call: Set<number>; put: Set<number> } = { call: new Set(), put: new Set() };

  /**
   * Delta x OI: the few strikes on each side that hold the most of it, by price. A strike becomes
   * heavy at HEAVY_SHARE of its side's largest and in the top few; once heavy it stays so until it
   * drops under HEAVY_KEEP, or out of the top few more, so a figure wobbling at the line holds still.
   */
  private heaviest(levels: readonly OiBarLevel[], shown: readonly Side[]): { call: Set<number>; put: Set<number> } {
    const pick = (side: Side) => {
      if (!shown.includes(side)) return new Set<number>();
      const ranked = levels
        .map((l) => ({ price: l.price, v: total(l, side) }))
        .filter((x) => Number.isFinite(x.v) && x.v > 0)
        .sort((a, b) => b.v - a.v);
      const top = ranked[0]?.v ?? 0;
      const held = this.kept[side];
      const next = new Set<number>();
      ranked.forEach((x, rank) => {
        const keeps = held.has(x.price) && x.v >= top * HEAVY_KEEP && rank < HEAVY_MAX + 2;
        const enters = x.v >= top * HEAVY_SHARE && rank < HEAVY_MAX;
        if ((keeps || enters) && next.size < HEAVY_MAX + 1) next.add(x.price);
      });
      this.kept[side] = next;
      return next;
    };
    return { call: pick("call"), put: pick("put") };
  }

  /** A heavy strike: its bar outlined, and beside it an arrow (adding or reducing), its exposure and the move. */
  private heavyMark(ctx: CanvasRenderingContext2D, xEnd: number, y: number, h: number, scale: number, level: OiBarLevel, side: Side, color: string, dpr: number): void {
    const t = total(level, side);
    const len = Math.round(t * scale);
    if (!Number.isFinite(t) || len <= 0) return;
    const x = xEnd - len;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, len - 1), Math.max(0, h - 1));
    const c = change(level, side);
    const dir = Number.isFinite(c) ? Math.sign(c) : 0;
    // The arrow says which way exposure moved (added or shed), the figures how much.
    const text = `${dir > 0 ? "▲ " : dir < 0 ? "▼ " : ""}${compact(t)}${dir !== 0 ? `  ${dir > 0 ? "+" : "−"}${compact(c)}` : ""}`;
    this.chips.push({ text, right: x - Math.round(CHIP_GAP * dpr), y: y + h / 2, color });
  }

  private largest(levels: readonly OiBarLevel[], mode: OiBarsMode, shown: readonly Side[]): number {
    let max = 0;
    for (const level of levels) {
      for (const side of shown) {
        const v = extent(level, side, mode);
        if (Number.isFinite(v) && v > max) max = v;
      }
    }
    return max;
  }

  /** One side's bar at `y`: filled, or hollow (an outline only) for a negative value — OI shed. */
  private bar(ctx: CanvasRenderingContext2D, xEnd: number, y: number, h: number, scale: number, value: number, color: string): void {
    if (!Number.isFinite(value) || value === 0) return;
    const len = Math.round(Math.abs(value) * scale);
    if (len <= 0) return;
    const x = xEnd - len;
    if (value < 0) {
      ctx.globalAlpha = STROKE_ALPHA;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, len - 1), Math.max(0, h - 1));
    } else {
      ctx.globalAlpha = FILL_ALPHA;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, len, h);
    }
  }

  /** `both`: total OI dimmed, today's addition solid at its outer end, OI shed outlined beyond it. */
  private layered(ctx: CanvasRenderingContext2D, xEnd: number, y: number, h: number, scale: number, level: OiBarLevel, side: Side, color: string, totalAlpha = TOTAL_ALPHA): void {
    const t = total(level, side);
    if (!Number.isFinite(t) || t <= 0) return;
    const c = change(level, side);
    const len = Math.round(t * scale);
    if (len <= 0) return;
    const x = xEnd - len;
    ctx.globalAlpha = totalAlpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, len, h);
    ctx.globalAlpha = 1;
    if (!Number.isFinite(c) || c === 0) return;
    const cLen = Math.round(Math.abs(c) * scale);
    if (cLen <= 0) return;
    if (c > 0) {
      const w = Math.min(cLen, len);
      ctx.globalAlpha = CHANGE_ALPHA;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = CHANGE_GREY;
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - cLen + 0.5, y + 0.5, Math.max(0, cLen - 1), Math.max(0, h - 1));
    }
  }

  /** "Call OI +48,230", a call-out to the left of the bar. */
  private label(xEnd: number, y: number, h: number, scale: number, level: OiBarLevel, side: Side, color: string, dpr: number): void {
    const len = Math.round(total(level, side) * scale);
    const added = change(level, side);
    this.chips.push({ text: `${side === "call" ? "Call" : "Put"} OI +${fmt0(added)}`, right: xEnd - len - Math.round(CHIP_GAP * dpr), y: y + h / 2, color });
  }

  /**
   * The call-outs, over the candles: each a box of its bar's colour with its figures in the ink
   * that reads on it, kept inside the plot, and stepped down clear of one above it that it would
   * cover, as the axis spreads its tags.
   */
  private drawChips(ctx: CanvasRenderingContext2D, dpr: number): void {
    if (this.chips.length === 0) return;
    const h = Math.round(CHIP_H * dpr);
    const pad = Math.round(CHIP_PAD * dpr);
    ctx.save();
    ctx.font = `${Math.round(LABEL_FONT * dpr)}px ${CHART_FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const placed: { left: number; right: number; top: number }[] = [];
    for (const chip of [...this.chips].sort((a, b) => a.y - b.y)) {
      const w = Math.ceil(ctx.measureText(chip.text).width) + 2 * pad;
      const left = Math.max(Math.round(4 * dpr), chip.right - w);
      let top = Math.round(chip.y - h / 2);
      for (const p of placed) {
        if (left < p.right && left + w > p.left && top < p.top + h + 1 && top + h + 1 > p.top) top = p.top + h + 1;
      }
      placed.push({ left, right: left + w, top });
      ctx.fillStyle = chip.color;
      ctx.beginPath();
      ctx.roundRect(left, top, w, h, h / 8);
      ctx.fill();
      ctx.fillStyle = inkOn(chip.color);
      ctx.fillText(chip.text, left + pad, top + h / 2);
    }
    ctx.restore();
  }
}
