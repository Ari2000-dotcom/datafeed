import { useState } from "react";
import type { Bar as OaBar } from "openalgo-charts";

import { fmt2 } from "../core/format";
import { ChevronGlyph, EyeGlyph, TrashGlyph, Value } from "../straddle/StraddleLegend";

/** An indicator on the price pane, as the legend reads it at the candle shown. */
export interface ScripLegendRow {
  id: string;
  name: string;
  colour: string;
  value: number | null;
  hidden: boolean;
}

const COLLAPSED_KEY = "mh.scrip-legend.collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The scrip chart's status line, TradingView's way, on the price pane's top-left: the instrument
 * (name · interval · exchange) with the candle's open, high, low and close and its change on the
 * candle before, each number in the candle's own colour; then a row per indicator on the candles,
 * each in its line's colour, and the arrow that folds those rows away. Every number is the candle
 * under the crosshair, else the latest. A row's controls (show or hide, remove) appear while the
 * pointer is on it. The panes under the price (ATR, RSI) carry their own line on the canvas.
 */
export function ScripLegend({
  name,
  interval,
  exchange,
  trading,
  bar,
  prev,
  line,
  colors,
  rows,
  onToggle,
  onRemove,
}: Readonly<{
  name: string;
  /** TradingView's short form: "5" for five minutes, "1h", "1D". */
  interval: string;
  exchange: string;
  /** Live trades arriving now, or a closed market. */
  trading: boolean;
  bar: OaBar | undefined;
  /** The candle before `bar`: what its change is measured from. */
  prev: OaBar | undefined;
  /** A line or an area reads the close alone. */
  line: boolean;
  colors: { up: string; down: string };
  rows: readonly ScripLegendRow[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}>) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggleCollapsed = () => {
    setCollapsed((was) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, was ? "0" : "1");
      } catch {
        // A per-viewer convenience only.
      }
      return !was;
    });
  };

  // The candle's colour: up on a close at or over its open, as the candle itself is drawn.
  const tone = bar ? (bar.close >= bar.open ? colors.up : colors.down) : undefined;
  const change = bar && prev ? bar.close - prev.close : null;
  const sign = change === null ? "" : change > 0 ? "+" : change < 0 ? "−" : "";

  return (
    <div className="mh-legend">
      <div className="mh-legend-row mh-legend-main">
        <span className="mh-legend-titles">
          <span className="mh-legend-title mh-legend-name">{name}</span>
          <span className="mh-legend-title mh-legend-dot mh-legend-meta">{interval}</span>
          <span className="mh-legend-title mh-legend-dot mh-legend-meta">{exchange}</span>
        </span>
        <span className="mh-legend-status" title={trading ? "Market open" : "Market closed"}>
          <span className={trading ? "mh-legend-status-item mh-open" : "mh-legend-status-item"} aria-hidden />
        </span>
        {bar ? (
          <span className="mh-legend-values">
            {line ? (
              <Value text={fmt2(bar.close)} colour={tone} />
            ) : (
              <>
                <Value label="O" text={fmt2(bar.open)} colour={tone} />
                <Value label="H" text={fmt2(bar.high)} colour={tone} />
                <Value label="L" text={fmt2(bar.low)} colour={tone} />
                <Value label="C" text={fmt2(bar.close)} colour={tone} />
              </>
            )}
            {change !== null && prev && prev.close !== 0 ? (
              <span className="mh-legend-value" style={{ color: tone }}>
                {sign}
                {fmt2(Math.abs(change))} ({sign}
                {((Math.abs(change) / Math.abs(prev.close)) * 100).toFixed(2)}%)
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {collapsed
        ? null
        : rows.map((r) => (
            <div key={r.id} className="mh-legend-row" data-hidden={r.hidden || undefined}>
              <span className="mh-legend-titles">
                <span className="mh-legend-title">{r.name}</span>
              </span>
              <span className="mh-legend-values">
                <Value text={r.value !== null && Number.isFinite(r.value) ? fmt2(r.value) : "—"} colour={r.colour} />
              </span>
              <span className="mh-legend-buttons">
                <button type="button" className="mh-legend-button" aria-label={r.hidden ? `Show ${r.name}` : `Hide ${r.name}`} title={r.hidden ? "Show" : "Hide"} onClick={() => onToggle(r.id)}>
                  <EyeGlyph crossed={r.hidden} />
                </button>
                <button type="button" className="mh-legend-button" aria-label={`Remove ${r.name}`} title="Remove" onClick={() => onRemove(r.id)}>
                  <TrashGlyph />
                </button>
              </span>
            </div>
          ))}

      {rows.length > 0 ? (
        <button
          type="button"
          className="mh-legend-toggler"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show the indicator legend" : "Hide the indicator legend"}
          title={collapsed ? "Show the indicator legend" : "Hide the indicator legend"}
          onClick={toggleCollapsed}
        >
          <ChevronGlyph />
          {collapsed ? <span className="mh-legend-count">{rows.length}</span> : null}
        </button>
      ) : null}
    </div>
  );
}
