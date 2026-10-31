import { useState } from "react";

import type { Bar } from "../hub/types";
import { fmt0, fmt2 } from "../core/format";
import { lineOf, setFocus, toggleLine, type LineId } from "./StraddleChart";
import "./legend.css";

/** A picked strike's line, as the legend reads it at the minute shown. */
export interface LegendPick {
  strike: number;
  colour: string;
  value: number | null;
  first: number | null;
}

const COLLAPSED_KEY = "mh.legend.collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The chart's status line, TradingView's way, on the price pane's top-left: the instrument on the
 * first row (name · interval · exchange · ATM strike) with that minute's readings after it, then a
 * row per line on the pane, each in its own colour, and under them the arrow that folds those
 * rows away. Every number is the minute under the crosshair, else the latest. A row's controls
 * (show or hide, remove) appear while the pointer is on it.
 */
export function StraddleLegend({
  name,
  exchange,
  shown,
  open,
  hidden,
  picks,
  onRemovePick,
  trading,
}: Readonly<{
  name: string;
  exchange: string;
  /** Live minutes arriving now, or a closed market / a past session. */
  trading: boolean;
  shown: Bar | undefined;
  /** The open of the session `shown` is in: what each move is measured from. */
  open: Bar | undefined;
  hidden: ReadonlySet<LineId>;
  picks: readonly LegendPick[];
  onRemovePick: (strike: number) => void;
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
  const rows = 3 + picks.length;

  return (
    <div className="mh-legend">
      <div className="mh-legend-row mh-legend-main" onPointerEnter={() => setFocus("straddle")} onPointerLeave={() => setFocus(null)}>
        <span className="mh-legend-titles">
          <span className="mh-legend-title">{name}</span>
          <span className="mh-legend-title mh-legend-dot">1</span>
          <span className="mh-legend-title mh-legend-dot">{exchange}</span>
          {shown ? (
            <span className="mh-legend-title mh-legend-dot">
              ATM {fmt0(shown.strike)}
              {shown.rolled ? " (rolled)" : ""}
            </span>
          ) : null}
        </span>
        <span className="mh-legend-status" title={trading ? "Market open" : "Market closed"}>
          <span className={trading ? "mh-legend-status-item mh-open" : "mh-legend-status-item"} aria-hidden />
        </span>
        {shown ? (
          // TradingView's readout: each label against its number, every number in the one colour of
          // the straddle's move since the open.
          <span className={`mh-legend-values mh-legend-readout ${toneOf(shown.straddle, open?.straddle)}`}>
            <Value label="CE" text={fmt2(shown.call)} />
            <Value label="PE" text={fmt2(shown.put)} />
            <Value label="S" text={fmt2(shown.straddle)} />
            <Change value={shown.straddle} from={open?.straddle} toned={false} />
          </span>
        ) : null}
      </div>

      {collapsed
        ? null
        : (["vwap", "spot", "fut"] as const).map((id) => {
            const line = lineOf(id);
            const v = shown ? line.value(shown) : null;
            const from = open ? line.value(open) : null;
            const off = hidden.has(id);
            return (
              <div key={id} className="mh-legend-row" data-hidden={off || undefined} onPointerEnter={() => setFocus(id)} onPointerLeave={() => setFocus(null)}>
                <span className="mh-legend-titles">
                  <span className="mh-legend-title">{line.label}</span>
                </span>
                <span className="mh-legend-values">
                  <Value text={v !== null && Number.isFinite(v) ? line.format(v) : "—"} colour={`var(${line.colour})`} />
                  {id === "vwap" ? null : <Change value={v} from={from} />}
                </span>
                <span className="mh-legend-buttons">
                  <button type="button" className="mh-legend-button" aria-label={off ? `Show ${line.label}` : `Hide ${line.label}`} title={off ? "Show" : "Hide"} onClick={() => toggleLine(id)}>
                    <EyeGlyph crossed={off} />
                  </button>
                </span>
              </div>
            );
          })}

      {collapsed
        ? null
        : picks.map((p) => (
            <div key={p.strike} className="mh-legend-row">
              <span className="mh-legend-titles">
                <span className="mh-legend-title">{fmt0(p.strike)} straddle</span>
              </span>
              <span className="mh-legend-values">
                <Value text={p.value !== null ? fmt2(p.value) : "—"} colour={p.colour} />
                <Change value={p.value} from={p.first} />
              </span>
              <span className="mh-legend-buttons">
                <button type="button" className="mh-legend-button" aria-label={`Remove the ${p.strike} straddle`} title="Remove" onClick={() => onRemovePick(p.strike)}>
                  <TrashGlyph />
                </button>
              </span>
            </div>
          ))}

      <button
        type="button"
        className="mh-legend-toggler"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show the line legend" : "Hide the line legend"}
        title={collapsed ? "Show the line legend" : "Hide the line legend"}
        onClick={toggleCollapsed}
      >
        <ChevronGlyph />
        {collapsed ? <span className="mh-legend-count">{rows}</span> : null}
      </button>
    </div>
  );
}

/** One reading: an optional label in the legend's ink, the number in its line's colour. */
function Value({ label, text, colour }: Readonly<{ label?: string; text: string; colour?: string }>) {
  return (
    <span className="mh-legend-value">
      {label ? <span className="mh-legend-label">{label}</span> : null}
      <span style={colour ? { color: colour } : undefined}>{text}</span>
    </span>
  );
}

/** Green for a rise since the open, red for a fall, nothing for no move or no open. */
function toneOf(value: number | null | undefined, from: number | null | undefined): string {
  if (value == null || from == null || !Number.isFinite(value) || !Number.isFinite(from)) return "";
  return value > from ? "mh-up" : value < from ? "mh-down" : "";
}

/** The move since the session's open, TradingView's way: points, then percent, in the move's colour. */
function Change({ value, from, toned = true }: Readonly<{ value: number | null | undefined; from: number | null | undefined; toned?: boolean }>) {
  if (value == null || from == null || !Number.isFinite(value) || !Number.isFinite(from) || from === 0) return null;
  const d = value - from;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  return (
    <span className={toned ? `mh-legend-value ${toneOf(value, from)}` : "mh-legend-value"}>
      {sign}
      {fmt2(Math.abs(d))} ({sign}
      {((Math.abs(d) / Math.abs(from)) * 100).toFixed(2)}%)
    </span>
  );
}

/*
 * The legend's glyphs, drawn for an 18px box at one device pixel: straight strokes sit on half
 * pixels so a 1px line covers one row of pixels rather than smearing across two.
 */

function EyeGlyph({ crossed }: Readonly<{ crossed: boolean }>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M1.5 9C3.2 5.5 5.9 3.5 9 3.5s5.8 2 7.5 5.5c-1.7 3.5-4.4 5.5-7.5 5.5S3.2 12.5 1.5 9Z" />
      <circle cx="9" cy="9" r="2.5" />
      {crossed ? <path d="M3.5 15.5 15.5 2.5" /> : null}
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M3 5.5h12M7 5.5v-2h4v2M4.5 5.5l1 9.5h7l1-9.5" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6l3.5 3 3.5-3" />
    </svg>
  );
}
