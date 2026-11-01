import { useState } from "react";

import type { Bar } from "../hub/types";
import { fmt0, fmt2 } from "../core/format";
import { useFitRow } from "../ui/fitRow";
import { lineOf, percentMove, readingOf, setFocus, toggleLine, type LineId, type Move } from "./StraddleChart";
import "./legend.css";

/** A picked strike's line, as the legend reads it at the minute shown. */
export interface LegendPick {
  strike: number;
  colour: string;
  value: number | null;
  first: number | null;
}

// A new key (was "mh.legend.collapsed") so every legend opens unfolded once: one left folded
// earlier read as a past day with no spot, VWAP or synthetic future at all.
const COLLAPSED_KEY = "mh.legend.folded";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The figures a straddle desk reads first, in the order it reads them, each against its label and
 * in its line's colour: the underlying (MCX: the future its options are written on), the synthetic
 * future, the straddle's VWAP (its average price this session) and the ATM IV. `drop` is the rank
 * at which a figure gives way on a plot too slim for the whole line (ui/fitRow.ts); VWAP never does.
 */
const FIGURES: readonly { id: LineId; label: string; title: string; drop?: number }[] = [
  { id: "spot", label: "Spot", title: "The underlying's spot", drop: 5 },
  { id: "fut", label: "Syn fut", title: "Synthetic future: call − put + strike", drop: 4 },
  { id: "vwap", label: "VWAP", title: "The straddle's average price this session (VWAP)" },
  { id: "iv", label: "IV", title: "ATM implied volatility, its move in vol points", drop: 3 },
];

/**
 * The chart's status line, on the price pane's top-left. Its first row is the figures, not the
 * instrument's name (the toolbar names the active chart): the market's mark, then spot, the
 * synthetic future, VWAP and IV, each with its move since the session's open, then the ATM legs and
 * the straddle itself. A click on a figure shows or hides its line; pointing at one puts its line
 * forward. On a slim plot the least needed give way first: the legs, then the moves, then IV, the
 * synthetic future and spot; VWAP and the straddle stay. Under it, a row per straddle added from
 * the chain, and the arrow that folds those away. Every number is the minute under the crosshair,
 * else the latest.
 *
 * With the data table on the chart (`withTable`), the line does not say twice what the table says:
 * each figure's move and the legs give way to it, and the line keeps each value and the straddle's
 * own move.
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
  closedOn,
  mcx,
  withTable = false,
}: Readonly<{
  name: string;
  exchange: string;
  /** Live minutes arriving now, or a closed market / a past session. */
  trading: boolean;
  /** Today asked for with nothing traded yet: the session shown in its place ("Fri, 30 Oct"), for the status mark's tooltip. */
  closedOn?: string;
  /** MCX has no spot: its "spot" line is the future its options are written on, and says so. */
  mcx: boolean;
  /** The data table is on the chart: its moves and legs are not repeated here. */
  withTable?: boolean;
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
  const straddle = readingOf("straddle", shown, open);
  const fitFigures = useFitRow();
  const atm = shown ? `ATM ${fmt0(shown.strike)}${shown.rolled ? " (rolled)" : ""}` : "";

  return (
    <div className="mh-legend">
      <div className="mh-legend-row mh-legend-main" aria-label={`${name} · ${exchange}${atm ? ` · ${atm}` : ""}`} onPointerEnter={() => setFocus("straddle")} onPointerLeave={() => setFocus(null)}>
        {/* The market's state, TradingView's way: this mark alone, on every chart; its tooltip names
            the session shown while today has nothing traded yet. */}
        <span className="mh-legend-status" title={trading ? "Market open" : closedOn ? `Market closed · showing ${closedOn}` : "Market closed"}>
          <span className={trading ? "mh-legend-status-item mh-open" : "mh-legend-status-item"} aria-hidden />
        </span>
        {shown ? (
          <span className="mh-legend-values mh-legend-figures" ref={fitFigures}>
            {FIGURES.map(({ id, label, title, drop }) => {
              const line = lineOf(id);
              const said = id === "spot" && mcx ? "Fut" : label;
              const r = readingOf(id, shown, open);
              const off = hidden.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  className="mh-legend-figure"
                  data-drop={drop}
                  data-off={off || undefined}
                  aria-pressed={!off}
                  title={`${id === "spot" && mcx ? "The future the options are written on" : title} · click to ${off ? "show" : "hide"} its line`}
                  onPointerEnter={() => setFocus(id)}
                  onPointerLeave={() => setFocus("straddle")}
                  onClick={() => toggleLine(id)}
                >
                  <span className="mh-legend-label">{said}</span>
                  <span className="mh-legend-number" style={off ? undefined : { color: `var(${line.colour})` }}>
                    {r.value}
                  </span>
                  {r.move && !withTable ? (
                    <span className={`mh-legend-move ${off ? "" : toneOf(r.move)}`} data-drop={2}>
                      ({r.move.text})
                    </span>
                  ) : null}
                </button>
              );
            })}
            {/* The ATM legs and the straddle, every number in the colour of the straddle's move. */}
            {withTable ? null : (
              <span className={`mh-legend-readout mh-legend-legs ${toneOf(straddle.move)}`} data-drop={1} title={atm}>
                <Value label="CE" text={fmt2(shown.call)} />
                <Value label="PE" text={fmt2(shown.put)} />
              </span>
            )}
            <span className={`mh-legend-readout mh-legend-straddle ${toneOf(straddle.move)}`} title={`The ${atm} straddle: call + put`}>
              <Value label="S" text={straddle.value} />
              <Moved move={straddle.move} toned={false} />
            </span>
          </span>
        ) : null}
      </div>

      {collapsed
        ? null
        : picks.map((p) => (
            <div key={p.strike} className="mh-legend-row">
              <span className="mh-legend-titles">
                <span className="mh-legend-title">{fmt0(p.strike)} straddle</span>
              </span>
              <span className="mh-legend-values">
                <Value text={p.value !== null ? fmt2(p.value) : "—"} colour={p.colour} />
                <Moved move={p.value !== null && p.first !== null && p.value !== p.first ? percentMove(p.value, p.first) : null} />
              </span>
              <span className="mh-legend-buttons">
                <button type="button" className="mh-legend-button" aria-label={`Remove the ${p.strike} straddle`} title="Remove" onClick={() => onRemovePick(p.strike)}>
                  <TrashGlyph />
                </button>
              </span>
            </div>
          ))}

      {/* The fold, only while there are straddles added to fold away. */}
      {picks.length > 0 ? (
        <button
          type="button"
          className="mh-legend-toggler"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show the added straddles" : "Hide the added straddles"}
          title={collapsed ? "Show the added straddles" : "Hide the added straddles"}
          onClick={toggleCollapsed}
        >
          <ChevronGlyph />
          {collapsed ? <span className="mh-legend-count">{picks.length}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

/** One reading: an optional label in the legend's ink, the number in its line's colour. */
export function Value({ label, text, colour }: Readonly<{ label?: string; text: string; colour?: string }>) {
  return (
    <span className="mh-legend-value">
      {label ? <span className="mh-legend-label">{label}</span> : null}
      <span style={colour ? { color: colour } : undefined}>{text}</span>
    </span>
  );
}

/** Green for a rise since the open, red for a fall, nothing for no move (rounded to 0.00) or none yet. */
export function toneOf(move: Move | null): string {
  return move === null ? "" : move.dir > 0 ? "mh-up" : move.dir < 0 ? "mh-down" : "";
}

/**
 * A move since the session's open as the old chips row read it (`readingOf`, `percentMove`): a
 * percent ("+2.10%", IV in vol points), rounded before its sign is chosen so nothing reads
 * "−0.00%", and nothing at all on the opening minute itself. In the move's colour.
 */
export function Moved({ move, toned = true }: Readonly<{ move: Move | null; toned?: boolean }>) {
  if (move === null) return null;
  return <span className={toned ? `mh-legend-value ${toneOf(move)}` : "mh-legend-value"}>({move.text})</span>;
}

/*
 * The legend's glyphs, drawn for an 18px box at one device pixel: straight strokes sit on half
 * pixels so a 1px line covers one row of pixels rather than smearing across two.
 */

export function EyeGlyph({ crossed }: Readonly<{ crossed: boolean }>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M1.5 9C3.2 5.5 5.9 3.5 9 3.5s5.8 2 7.5 5.5c-1.7 3.5-4.4 5.5-7.5 5.5S3.2 12.5 1.5 9Z" />
      <circle cx="9" cy="9" r="2.5" />
      {crossed ? <path d="M3.5 15.5 15.5 2.5" /> : null}
    </svg>
  );
}

export function TrashGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M3 5.5h12M7 5.5v-2h4v2M4.5 5.5l1 9.5h7l1-9.5" />
    </svg>
  );
}

export function ChevronGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6l3.5 3 3.5-3" />
    </svg>
  );
}
