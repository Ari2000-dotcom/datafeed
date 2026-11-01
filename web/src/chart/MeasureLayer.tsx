import { useEffect, useState, type PointerEvent } from "react";
import type { Chart } from "openalgo-charts";

import { fmt2 } from "../core/format";
import { useCursorTool } from "./registry";

interface Span {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  p0: number;
  p1: number;
  t0: number;
  t1: number;
}

/** "45m", "2h 05m": a span of minutes as a desk reads it. */
function duration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/**
 * The measure tool on one chart, TradingView's: while the tools bar's Measure is on, a drag across
 * the price pane draws a box from where it started to the pointer, the accent blue when the price
 * rose and red when it fell, read out by it as the move in points and percent, the bars and the time it
 * spans. It stays until the next drag, Esc, or another tool. The layer covers the chart only while
 * the tool is on, so the chart pans and zooms as usual otherwise.
 */
export function MeasureLayer({
  getChart,
  stepSec,
  toPrice,
}: Readonly<{
  getChart: () => Chart | null;
  stepSec: number;
  /** The price at a y on the chart, where the main series is not on the pane's default scale (the straddle's premium). */
  toPrice?: (y: number) => number | null;
}>) {
  const tool = useCursorTool();
  const [span, setSpan] = useState<Span | null>(null);

  useEffect(() => {
    if (tool !== "measure") setSpan(null);
  }, [tool]);
  useEffect(() => {
    if (!span) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setSpan(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [span]);

  if (tool !== "measure") return null;

  const price = (chart: Chart, y: number) => (toPrice ? toPrice(y) : chart.coordinateToPrice(y));

  const at = (e: PointerEvent<HTMLDivElement>, chart: Chart) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(e.clientX - r.left);
    const y = Math.round(e.clientY - r.top);
    return { x, y, p: price(chart, y), t: chart.coordinateToTime(x) };
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const chart = getChart();
    if (!chart || e.button !== 0) return;
    const start = at(e, chart);
    if (start.p === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const first: Span = { x0: start.x, y0: start.y, x1: start.x, y1: start.y, p0: start.p, p1: start.p, t0: start.t, t1: start.t };
    setSpan(first);
    const layer = e.currentTarget;
    const move = (m: globalThis.PointerEvent) => {
      const r = layer.getBoundingClientRect();
      const x = Math.round(m.clientX - r.left);
      const y = Math.round(m.clientY - r.top);
      const p = price(chart, y);
      if (p === null) return;
      setSpan({ ...first, x1: x, y1: y, p1: p, t1: chart.coordinateToTime(x) });
    };
    const up = () => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
  };

  let box = null;
  if (span && (span.x0 !== span.x1 || span.y0 !== span.y1)) {
    const dp = span.p1 - span.p0;
    const pct = span.p0 !== 0 ? (dp / span.p0) * 100 : 0;
    const sign = dp > 0 ? "+" : dp < 0 ? "−" : "";
    const bars = Math.round(Math.abs(span.t1 - span.t0) / stepSec);
    const left = Math.min(span.x0, span.x1);
    const top = Math.min(span.y0, span.y1);
    const width = Math.abs(span.x1 - span.x0);
    const height = Math.abs(span.y1 - span.y0);
    box = (
      <div className="mh-measure-box" data-tone={dp < 0 ? "down" : "up"} style={{ left, top, width, height }}>
        <span className="mh-measure-label" data-below={span.y1 >= span.y0 || undefined}>
          {sign}
          {fmt2(Math.abs(dp))} ({sign}
          {Math.abs(pct).toFixed(2)}%) · {bars} {bars === 1 ? "bar" : "bars"} · {duration(Math.abs(span.t1 - span.t0))}
        </span>
      </div>
    );
  }

  return (
    <div className="mh-measure" onPointerDown={onDown}>
      {box}
    </div>
  );
}
