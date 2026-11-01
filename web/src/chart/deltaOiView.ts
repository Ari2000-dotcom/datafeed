import { useState } from "react";

/**
 * How the scrip chart's Δ × OI bars are cut, the same choices the Delta × OI panel gives (band,
 * session, units) and two the chart adds (which side to draw, how far back the change is read).
 * Kept on this computer. The session is not here: it is for the chart in front of you, so it starts
 * at Today each time an underlying or expiry is picked, as the panel's does.
 */

/** Strikes each side of the money the bars cover, or the whole chain. */
export const RANGES = [5, 10, 20, 40, "all"] as const;
export type Range = (typeof RANGES)[number];

export const SIDES = ["both", "call", "put"] as const;
export type Sides = (typeof SIDES)[number];

/** `contracts` as the feed counts open interest; `lot` times the lot, in units of the underlying. */
export const UNITS = ["contracts", "lot"] as const;
export type Unit = (typeof UNITS)[number];

/** How far back "the change" is read, minutes. */
export const SINCE = [1, 2, 5, 15] as const;
export type Since = (typeof SINCE)[number];

export interface DeltaOiView {
  range: Range;
  sides: Sides;
  unit: Unit;
  since: Since;
}

/** Every strike, both sides, contracts, against two minutes ago: what the view always was. */
export const DEFAULT_VIEW: DeltaOiView = { range: "all", sides: "both", unit: "contracts", since: 2 };

const KEY = "mh.scrip.deltaOi";

const oneOf = <T,>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

function readView(): DeltaOiView {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof DeltaOiView, unknown>>;
    return {
      range: oneOf(RANGES, raw.range, DEFAULT_VIEW.range),
      sides: oneOf(SIDES, raw.sides, DEFAULT_VIEW.sides),
      unit: oneOf(UNITS, raw.unit, DEFAULT_VIEW.unit),
      since: oneOf(SINCE, raw.since, DEFAULT_VIEW.since),
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function useDeltaOiView(): [DeltaOiView, (patch: Partial<DeltaOiView>) => void] {
  const [view, setView] = useState<DeltaOiView>(readView);
  const change = (patch: Partial<DeltaOiView>) => {
    const next = { ...view, ...patch };
    setView(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // A per-viewer convenience only.
    }
  };
  return [view, change];
}
