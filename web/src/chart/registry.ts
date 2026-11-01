import { useSyncExternalStore } from "react";
import type { Chart } from "openalgo-charts";

/*
 * The charts on the desk, by their grid panel id, and the left tools bar's state. The tools act on
 * the active chart (zoom, reset, screenshot) or on every chart at once (the cursor: crosshair,
 * magnet, measure), as TradingView's own left bar does.
 */

export type CursorTool = "cross" | "magnet" | "measure";

const charts = new Map<string, Chart>();
let tool: CursorTool = "cross";
const listeners = new Set<() => void>();
const changed = () => {
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const crosshairOf = (t: CursorTool) => (t === "magnet" ? "magnet" : "normal");

/** Puts a chart on the desk's list; the returned function takes it off. */
export function registerChart(panelId: string, chart: Chart): () => void {
  charts.set(panelId, chart);
  chart.applyOptions({ crosshairMode: crosshairOf(tool) });
  return () => {
    if (charts.get(panelId) === chart) charts.delete(panelId);
  };
}

export const chartOf = (panelId: string | null): Chart | undefined => (panelId ? charts.get(panelId) : undefined);

export const useCursorTool = (): CursorTool => useSyncExternalStore(subscribe, () => tool);

export function setCursorTool(next: CursorTool) {
  if (tool === next) return;
  tool = next;
  for (const chart of charts.values()) chart.applyOptions({ crosshairMode: crosshairOf(next) });
  changed();
}
