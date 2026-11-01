import { useSyncExternalStore } from "react";

import { fmt0, fmt2 } from "../core/format";
import type { Bar } from "../hub/types";
import "./table.css";

/*
 * The straddle chart's data table, TradingView's way (a Pine `table` pinned in the pane's
 * bottom-right corner): one row per figure the desk reads off the ATM straddle (spot, or on MCX the
 * future; the synthetic future and the basis between them; the two legs, the straddle and its
 * VWAP), its price, the change since the session opened in points and in percent. It reads the
 * minute under the crosshair, else the latest, as the legend does, and it takes no pointer: the
 * crosshair runs underneath. Shown or hidden from its legend row's eye or the Indicators menu.
 */

const SHOWN_KEY = "mh.straddle.table";

function readShown(): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) !== "0";
  } catch {
    return true;
  }
}

let shownState = readShown();
const listeners = new Set<() => void>();

/** Shows or hides the table on every straddle chart at once (the Indicators menu). */
export function toggleTable() {
  shownState = !shownState;
  try {
    localStorage.setItem(SHOWN_KEY, shownState ? "1" : "0");
  } catch {
    // A per-viewer convenience only.
  }
  for (const fn of listeners) fn();
}

export const useTableShown = (): boolean =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => shownState,
  );

type Tone = "mh-up" | "mh-down" | "";

/** Rounded first, so a sign is never put on a figure that reads 0.00. */
const round2 = (v: number) => Number(v.toFixed(2));
const toneOf = (v: number): Tone => (v > 0 ? "mh-up" : v < 0 ? "mh-down" : "");
const signed = (v: number, unit = "") => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt2(Math.abs(v))}${unit}`;

interface Row {
  label: string;
  side?: "call" | "put";
  /** None while the session has none yet (VWAP before its first trade). */
  price: number | null;
  /** The same figure at the session's open; none on the opening minute itself. */
  from: number | null;
  /** The % column: the change since the open as a percent of it, or (basis) a share of spot. */
  pct?: number;
}

export function StraddleTable({ shown, open, mcx }: Readonly<{ shown: Bar; open: Bar | undefined; mcx: boolean }>) {
  // The opening minute has nothing to move from: its change cells stay empty, as the legend's do.
  const base = open && open !== shown ? open : null;
  const basis = shown.synth - shown.spot;
  const rows: Row[] = [
    // MCX has no spot: its first figure is the future its options are written on.
    { label: mcx ? "Fut" : "Spot", price: shown.spot, from: base?.spot ?? null },
    { label: "Syn fut", price: shown.synth, from: base?.synth ?? null },
    // The synthetic future's premium over spot; its percent is that premium as a share of spot.
    { label: "Basis", price: basis, from: base ? base.synth - base.spot : null, pct: shown.spot !== 0 ? (basis / shown.spot) * 100 : undefined },
    { label: "CE", side: "call", price: shown.call, from: base?.call ?? null },
    { label: "PE", side: "put", price: shown.put, from: base?.put ?? null },
    { label: "Straddle", price: shown.straddle, from: base?.straddle ?? null },
    // The straddle's session average, the chart's yellow line.
    { label: "VWAP", price: shown.vwap, from: base?.vwap ?? null },
  ];

  return (
    <table className="mh-dtable" aria-label={`ATM ${fmt0(shown.strike)} straddle`}>
      <thead>
        <tr>
          <th className="mh-dtable-name">
            ATM {fmt0(shown.strike)}
            {shown.rolled ? " (rolled)" : ""}
          </th>
          <th>Price</th>
          <th>Chg</th>
          <th>%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isBasis = row.pct !== undefined;
          const price = row.price !== null && Number.isFinite(row.price) ? row.price : null;
          const chg = price !== null && row.from !== null && Number.isFinite(row.from) ? round2(price - row.from) : null;
          const pct = isBasis ? round2(row.pct!) : price !== null && chg !== null && row.from ? round2(((price - row.from) / row.from) * 100) : null;
          return (
            <tr key={row.label}>
              <th scope="row" className="mh-dtable-name" data-side={row.side}>
                {row.label}
              </th>
              <td className={price === null ? "mh-dtable-none" : undefined}>{price === null ? "—" : isBasis ? signed(round2(price)) : fmt2(price)}</td>
              <td className={chg === null ? "mh-dtable-none" : toneOf(chg)}>{chg === null ? "—" : signed(chg)}</td>
              {/* A premium is not a move: the basis's share of spot stays in plain ink. */}
              <td className={pct === null ? "mh-dtable-none" : isBasis ? "mh-dtable-quiet" : toneOf(pct)}>{pct === null ? "—" : signed(pct, "%")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
