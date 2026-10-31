import type { Bar } from "../hub/types";
import { fmt0, fmt2 } from "../core/format";
import { CloseIcon, EyeIcon, EyeOffIcon } from "../ui/icons";
import { lineOf, setFocus, toggleLine, type LineId } from "./StraddleChart";
import "./legend.css";

/** A picked strike's line, as the legend reads it at the minute shown. */
export interface LegendPick {
  strike: number;
  colour: string;
  value: number | null;
  first: number | null;
}

/**
 * The chart's status line, TradingView's way, on the price pane's top-left: the instrument on the
 * first row (name · interval · exchange) with that minute's readings after it, then a row per
 * line on the pane, each in its own colour. Every number is the minute under the crosshair, else
 * the latest. A row's controls (show or hide, remove) appear while the pointer is on it.
 */
export function StraddleLegend({
  name,
  exchange,
  shown,
  open,
  hidden,
  picks,
  onRemovePick,
}: Readonly<{
  name: string;
  exchange: string;
  shown: Bar | undefined;
  /** The open of the session `shown` is in: what each move is measured from. */
  open: Bar | undefined;
  hidden: ReadonlySet<LineId>;
  picks: readonly LegendPick[];
  onRemovePick: (strike: number) => void;
}>) {
  return (
    <div className="mh-legend">
      <div className="mh-legend-row mh-legend-main" onPointerEnter={() => setFocus("straddle")} onPointerLeave={() => setFocus(null)}>
        <span className="mh-legend-titles">
          <span className="mh-legend-title">{name}</span>
          <span className="mh-legend-title mh-legend-dot">1</span>
          <span className="mh-legend-title mh-legend-dot">{exchange}</span>
        </span>
        {shown ? (
          <span className="mh-legend-values">
            <Value label="ATM" text={`${fmt0(shown.strike)}${shown.rolled ? " (rolled)" : ""}`} />
            <Value label="CE" text={fmt2(shown.call)} colour="var(--mh-up)" />
            <Value label="PE" text={fmt2(shown.put)} colour="var(--mh-down)" />
            <Value label="S" text={fmt2(shown.straddle)} colour={`var(${lineOf("straddle").colour})`} />
            <Change value={shown.straddle} from={open?.straddle} />
          </span>
        ) : null}
      </div>

      {(["vwap", "spot", "fut"] as const).map((id) => {
        const line = lineOf(id);
        const v = shown ? line.value(shown) : null;
        const from = open ? line.value(open) : null;
        const off = hidden.has(id);
        return (
          <div
            key={id}
            className="mh-legend-row"
            data-hidden={off || undefined}
            onPointerEnter={() => setFocus(id)}
            onPointerLeave={() => setFocus(null)}
          >
            <span className="mh-legend-titles">
              <span className="mh-legend-title">{line.label}</span>
            </span>
            <span className="mh-legend-values">
              <Value text={v !== null && Number.isFinite(v) ? line.format(v) : "—"} colour={`var(${line.colour})`} />
              {id === "vwap" ? null : <Change value={v} from={from} />}
            </span>
            <span className="mh-legend-buttons">
              <button type="button" className="mh-legend-button" aria-label={off ? `Show ${line.label}` : `Hide ${line.label}`} title={off ? "Show" : "Hide"} onClick={() => toggleLine(id)}>
                {off ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </span>
          </div>
        );
      })}

      {picks.map((p) => (
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
              <CloseIcon size={14} />
            </button>
          </span>
        </div>
      ))}
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

/** The move since the session's open, TradingView's way: points, then percent, in the move's colour. */
function Change({ value, from }: Readonly<{ value: number | null | undefined; from: number | null | undefined }>) {
  if (value == null || from == null || !Number.isFinite(value) || !Number.isFinite(from) || from === 0) return null;
  const d = value - from;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  const tone = d > 0 ? "mh-up" : d < 0 ? "mh-down" : "";
  return (
    <span className={`mh-legend-value ${tone}`}>
      {sign}
      {fmt2(Math.abs(d))} ({sign}
      {((Math.abs(d) / Math.abs(from)) * 100).toFixed(2)}%)
    </span>
  );
}
