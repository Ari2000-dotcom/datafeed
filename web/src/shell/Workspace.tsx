import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type FunctionComponent } from "react";
import { DockviewReact, type DockviewApi, type DockviewDidDropEvent, type DockviewReadyEvent, type IDockviewPanel, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from "dockview";

import { dayLabel } from "../core/format";
import { DeltaOiPanel } from "../greeks/DeltaOiPanel";
import type { Hub } from "../hub/client";
import { readPick, StraddlePage, type Pick } from "../straddle/StraddlePage";
import { ScripPage, type ScripPick } from "../chart/ScripPage";
import { Crash, CrashNote } from "../ui/Crash";
import { ARRANGEMENTS, arrangementFor, arrangementOf, type Arrangement, type ArrangementId } from "./arrangements";
import { AddContainer, ContainerActions, DeskTab } from "./ContainerBar";
import { installDockBalance } from "./dockBalance";
import { DOCK_DRAG } from "./dockDrag";
import { DropMap } from "./DropMap";
import { setActivePanel, withHeaderSlot } from "./headerSlot";

/**
 * The chart grid, TradingView's way: one to four charts in one of the layouts of the top toolbar's
 * picker (`arrangements.ts`), on the same dockview the desk has always used, for its splitters and
 * its saving. Each cell holds one chart and shows no header of its own: the active chart's controls
 * are in the top toolbar (`headerSlot.tsx`), its values in its own legend. A click on a chart makes
 * it the active one, framed in the accent blue. A cell can also be Delta × OI: picked from the chart
 * kinds, or dragged out of the side panel's header onto the grid (`DOCK_DRAG`) and dropped on a
 * chart's edge to sit beside, above or below it, or on its middle to take its place. Dragging a
 * cell's tab onto another's edge moves it there. The option chain and the tables live in the side
 * and bottom panels.
 *
 * The grid is saved on this computer as it changes (`mh.desk.v2`) and comes back on the next visit;
 * a desk saved by the old tabbed layout comes back as its charts, in order, in the layout that fits
 * their number.
 */

const DESK_KEY = "mh.desk.v2";
/** Where the tabbed desk kept its screens' layouts, read once to bring their charts over. */
const LEGACY_VIEW_KEY = "mh.view";
const legacyKey = (view: string | null) => (view && view !== "workspace" ? `mh.layout.${view}` : "mh.layout");
/** Coalesced: a splitter drag changes the layout every frame. */
const SAVE_DELAY_MS = 400;

export type ChartKind = "straddle" | "scrip" | "deltaoi";
export const isChartKind = (c: unknown): c is ChartKind => c === "straddle" || c === "scrip" || c === "deltaoi";

export interface ChartSpec {
  component: ChartKind;
  params: Record<string, unknown>;
  title?: string;
}

/** The desk as saved, here and in a saved workspace. */
export interface DeskState {
  v: 2;
  arrangement: ArrangementId;
  dock: unknown;
}
const isDesk = (x: unknown): x is DeskState => typeof x === "object" && x !== null && (x as { v?: unknown }).v === 2;

interface StraddleParams {
  pick?: Pick | null;
  /** An underlying picked by name once the hub is there. */
  autoPick?: string;
}

interface ScripParams {
  id?: string;
  interval?: string;
}

interface DeltaOiParams {
  pick?: Pick | null;
}

const Desk = createContext<{ hub: Hub; themeKey: string } | null>(null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A straddle chart's title: the underlying and its expiry, and the day when it is a past session. */
function titleOf(pick: Pick | null | undefined, autoPick?: string): string {
  if (!pick) return autoPick ?? "New straddle";
  const [, m, d] = pick.expiry.split("-").map(Number);
  const expiry = `${d} ${MONTHS[(m ?? 1) - 1]}`;
  return pick.day === "live" ? `${pick.underlying.name} · ${expiry}` : `${pick.underlying.name} · ${expiry} · ${dayLabel(pick.day)}`;
}

/** A Delta × OI cell's title: the underlying and its expiry, and the day when it is a past session. */
function deltaTitle(pick: Pick | null | undefined): string {
  if (!pick) return "Δ × OI";
  const [, m, d] = pick.expiry.split("-").map(Number);
  const expiry = `${d} ${MONTHS[(m ?? 1) - 1]}`;
  return pick.day === "live" ? `Δ × OI · ${pick.underlying.name} · ${expiry}` : `Δ × OI · ${pick.underlying.name} · ${expiry} · ${dayLabel(pick.day)}`;
}

// One sequence for every chart made, so two made in one millisecond cannot collide.
let counter = 0;
const nextId = (kind: ChartKind) => `${kind}-${++counter}-${Date.now()}`;

/* -- the layout in use, for the picker ---------------------------------------------------------- */

let arrangement: ArrangementId = "1";
const arrangementListeners = new Set<() => void>();
function setArrangement(id: ArrangementId) {
  if (arrangement === id) return;
  arrangement = id;
  for (const fn of arrangementListeners) fn();
}
export const useArrangement = (): ArrangementId =>
  useSyncExternalStore(
    (fn) => {
      arrangementListeners.add(fn);
      return () => arrangementListeners.delete(fn);
    },
    () => arrangement,
  );

/* -- a cell's content: one chart ---------------------------------------------------------------- */

function StraddlePanel({ api, params }: IDockviewPanelProps<StraddleParams>) {
  const desk = useContext(Desk);
  const [front, setFront] = useState(api.isActive);
  useEffect(() => {
    const subscription = api.onDidActiveChange((e) => setFront(e.isActive));
    return () => subscription.dispose();
  }, [api]);
  if (!desk) return null;
  return (
    <StraddlePage
      hub={desk.hub}
      themeKey={desk.themeKey}
      initialPick={params.pick ?? null}
      autoPick={params.autoPick}
      active={front}
      onPick={(pick) => {
        const title = titleOf(pick, params.autoPick);
        if (api.title !== title) api.setTitle(title);
        api.updateParameters({ pick, autoPick: pick ? undefined : params.autoPick });
      }}
    />
  );
}

function ScripDockPanel({ api, params }: IDockviewPanelProps<ScripParams>) {
  const desk = useContext(Desk);
  if (!desk) return null;
  return (
    <ScripPage
      hub={desk.hub}
      themeKey={desk.themeKey}
      initialId={params.id}
      initialInterval={params.interval}
      onPick={(pick: ScripPick | null) => {
        const title = pick ? `Chart · ${pick.name}` : "Chart";
        if (api.title !== title) api.setTitle(title);
        api.updateParameters({ id: pick?.id, interval: pick?.interval });
      }}
    />
  );
}

/** Delta × OI as a cell of the grid: the same panel the side rail opens, set where a chart would be. */
function DeltaOiDockPanel({ api, params }: IDockviewPanelProps<DeltaOiParams>) {
  const desk = useContext(Desk);
  if (!desk) return null;
  return (
    <div className="mh-page">
      <section className="mh-container" aria-label="Delta × OI">
        <DeltaOiPanel
          hub={desk.hub}
          initialPick={params.pick ?? null}
          onPick={(pick) => {
            const title = deltaTitle(pick);
            if (api.title !== title) api.setTitle(title);
            api.updateParameters({ pick });
          }}
        />
      </section>
    </div>
  );
}

/**
 * A chart that fails to draw says so in its own cell, and the rest of the desk carries on. What it
 * was showing comes back with the layout on every visit, so it may be what broke it; starting over
 * drops that and opens the chart empty.
 */
function guarded<T extends object>(Panel: FunctionComponent<IDockviewPanelProps<T>>): FunctionComponent<IDockviewPanelProps<T>> {
  function Guarded(props: IDockviewPanelProps<T>) {
    const { api, params } = props;
    return (
      <Crash
        fallback={(error, retry) => (
          <CrashNote title="This chart stopped" error={error}>
            <button
              type="button"
              className="mh-btn"
              onClick={() => {
                api.updateParameters(Object.fromEntries(Object.keys(params ?? {}).map((key) => [key, undefined])));
                retry();
              }}
            >
              Start this chart over
            </button>
          </CrashNote>
        )}
      >
        <Panel {...props} />
      </Crash>
    );
  }
  return Guarded;
}

const COMPONENTS = {
  straddle: guarded(withHeaderSlot(StraddlePanel)),
  scrip: guarded(withHeaderSlot(ScripDockPanel)),
  deltaoi: guarded(withHeaderSlot(DeltaOiDockPanel)),
};

/** The chart kinds, as the toolbar's chart picker names them. */
export const CHART_KINDS: readonly { kind: ChartKind; name: string; note: string }[] = [
  { kind: "straddle", name: "Straddle", note: "ATM straddle, VWAP, IV" },
  { kind: "scrip", name: "Scrip chart", note: "Candles, OI profile" },
  { kind: "deltaoi", name: "Delta × OI", note: "Call and put exposure per strike" },
];

/* -- building the grid -------------------------------------------------------------------------- */

type Position = Parameters<DockviewApi["addPanel"]>[0]["position"];

function addChart(api: DockviewApi, spec: ChartSpec, position?: Position): IDockviewPanel {
  const title =
    spec.title ??
    (spec.component === "straddle"
      ? titleOf((spec.params as StraddleParams).pick, (spec.params as StraddleParams).autoPick)
      : spec.component === "deltaoi"
        ? deltaTitle((spec.params as DeltaOiParams).pick)
        : "Chart");
  const panel = api.addPanel({ id: nextId(spec.component), component: spec.component, title, params: spec.params, position });
  return panel;
}

/** The charts in reading order: row by row from the top, left to right in a row. */
export function chartsInOrder(api: DockviewApi): IDockviewPanel[] {
  const cells = api.groups.map((g) => ({ g, r: g.element.getBoundingClientRect() }));
  cells.sort((a, b) => (Math.abs(a.r.top - b.r.top) > 4 ? a.r.top - b.r.top : a.r.left - b.r.left));
  return cells.flatMap(({ g }) => (g.activePanel ? [g.activePanel] : []));
}

const specOf = (panel: IDockviewPanel): ChartSpec => ({
  component: isChartKind(panel.api.component) ? panel.api.component : "straddle",
  params: JSON.parse(JSON.stringify(panel.params ?? {})) as Record<string, unknown>,
  title: panel.title,
});

/** A new cell's chart: the same as the one it copies (TradingView opens new cells on the active symbol). */
const copyOf = (spec: ChartSpec): ChartSpec => ({ ...spec, params: JSON.parse(JSON.stringify(spec.params)) as Record<string, unknown> });

/** Cells being laid out in bulk (a layout built or loaded): the picker is told what they are, not worked out from them. */
let quiet = 0;

/** A whole layout is about to change: leave a container that fills the desk, and hold the layout sync until it settles. */
function hush(api: DockviewApi) {
  if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
  quiet++;
  // A timer, not a frame: a tab in the background runs no frames, and the sync would wait on it.
  window.setTimeout(() => quiet--, 400);
}

/** The picker told what is on screen, once dockview has settled; never while a layout is being laid out. */
function syncSoon(api: DockviewApi) {
  window.setTimeout(() => quiet === 0 && syncArrangement(api), 120);
}

/** Lays out `specs` as `target`, the `active`-th one in front. */
function build(api: DockviewApi, target: Arrangement, specs: readonly ChartSpec[], active: number) {
  setArrangement(target.id);
  hush(api);
  api.clear();
  const p: IDockviewPanel[] = [];
  const at = (i: number, ref?: number, direction?: "right" | "below") => {
    p[i] = addChart(api, specs[i]!, ref === undefined ? undefined : { referencePanel: p[ref]!, direction: direction! });
  };
  // Each cell after the first opens beside or under one already there; every split even, as
  // TradingView lays them.
  const PLAN: Record<ArrangementId, readonly (readonly [ref: number, direction: "right" | "below"])[]> = {
    "1": [],
    "2v": [[0, "right"]],
    "2h": [[0, "below"]],
    "3v": [[0, "right"], [1, "right"]],
    "1l2r": [[0, "right"], [1, "below"]],
    "1t2b": [[0, "below"], [1, "right"]],
    "2x2": [[0, "right"], [0, "below"], [1, "below"]],
    "1l3r": [[0, "right"], [1, "below"], [2, "below"]],
  };
  at(0);
  PLAN[target.id].forEach(([ref, direction], i) => at(i + 1, ref, direction));

  const w = (n: number) => Math.round(api.width / n);
  const h = (n: number) => Math.round(api.height / n);
  const SIZES: Record<ArrangementId, readonly { width?: number; height?: number }[]> = {
    "1": [],
    "2v": [{ width: w(2) }],
    "2h": [{ height: h(2) }],
    "3v": [{ width: w(3) }, { width: w(3) }],
    "1l2r": [{ width: w(2) }, { height: h(2) }],
    "1t2b": [{ height: h(2) }, { width: w(2) }],
    "2x2": [{ width: w(2), height: h(2) }, { height: h(2) }],
    "1l3r": [{ width: w(2) }, { height: h(3) }, { height: h(3) }],
  };
  SIZES[target.id].forEach((size, i) => p[i]?.api.setSize(size));
  p[Math.min(active, p.length - 1)]?.api.setActive();
}

/**
 * The grid as one of the ARRANGEMENTS. The charts on it keep their places in reading order; a cell
 * more than there are charts opens on a copy of the active one, and charts past the layout's last
 * cell go.
 */
export function applyArrangement(api: DockviewApi, id: ArrangementId) {
  const target = arrangementOf(id);
  const current = chartsInOrder(api);
  const active = Math.max(0, current.findIndex((p) => p.api.isActive));
  const specs = current.map(specOf);
  const model = specs[active] ?? specs[0] ?? { component: "straddle", params: { pick: readPick() } };
  while (specs.length < target.count) specs.push(copyOf(model));
  build(api, target, specs.slice(0, target.count), Math.min(active, target.count - 1));
}

/** The active chart turned into another kind, in its own cell. */
export function replaceChart(api: DockviewApi, panelId: string, kind: ChartKind) {
  const old = api.getPanel(panelId);
  if (!old || old.api.component === kind) return;
  const pick = (old.params as StraddleParams | undefined)?.pick ?? readPick();
  // A scrip chart opens on the straddle's underlying, Delta × OI on its pick; a straddle on the last pick made.
  const params: Record<string, unknown> = kind === "scrip" ? { id: pick?.underlying.id } : kind === "deltaoi" ? { pick } : { pick: readPick() };
  const title = kind === "scrip" ? "Chart" : kind === "deltaoi" ? deltaTitle(pick) : titleOf(readPick());
  const panel = api.addPanel({ id: nextId(kind), component: kind, title, params, position: { referencePanel: old } });
  old.api.close();
  panel.api.setActive();
}

/**
 * `count` containers where this one stands: it and `count - 1` copies of it, in a row (`right`) or
 * a column (`below`), each added off the last so three rows divide this container's own footprint
 * into three. QuantDesk's "Split this container". False when the desk has no room for them.
 */
export function splitCell(api: DockviewApi, panelId: string, count: number, direction: "below" | "right"): boolean {
  const panel = api.getPanel(panelId);
  if (!panel || count < 2 || api.groups.length + count - 1 > MOST_CELLS) return false;
  const spec = specOf(panel);
  let last = panel;
  for (let i = 1; i < count; i++) last = addChart(api, copyOf(spec), { referencePanel: last, direction });
  return true;
}

/* -- Delta × OI dragged in from the side panel -------------------------------------------------- */

const DIRECTION = { top: "above", bottom: "below", left: "left", right: "right" } as const;

/** The most cells a layout of the picker has. */
export const MOST_CELLS = 4;

/**
 * The picker's layout nearest the cells as they stand: found by their rectangles, so a cell moved
 * by hand or docked from the side leaves the picker naming what is on screen.
 */
export function syncArrangement(api: DockviewApi) {
  const cells = api.groups.map((g) => g.element.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  if (cells.length === 0) return;
  const left = Math.min(...cells.map((r) => r.left));
  const top = Math.min(...cells.map((r) => r.top));
  const width = Math.max(...cells.map((r) => r.right)) - left;
  const height = Math.max(...cells.map((r) => r.bottom)) - top;
  if (width <= 0 || height <= 0) return;
  const rects = cells
    .map((r) => [(r.left - left) / width, (r.top - top) / height, r.width / width, r.height / height] as const)
    .sort((a, b) => (Math.abs(a[1] - b[1]) > 0.05 ? a[1] - b[1] : a[0] - b[0]));
  let best: Arrangement | null = null;
  let bestGap = Infinity;
  for (const candidate of ARRANGEMENTS.filter((a) => a.count === rects.length)) {
    const gap = candidate.rects.reduce((sum, c, i) => sum + c.reduce((s, v, k) => s + Math.abs(v - rects[i]![k]!), 0), 0);
    if (gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  if (best) setArrangement(best.id);
}

/** Whether a cell dropped from the side panel has room: a fifth one has none, but a chart's middle still takes it. */
export const canDock = (api: DockviewApi, position: string) => position === "center" || api.groups.length < MOST_CELLS;

type Cell = DockviewApi["groups"][number];

/**
 * A new cell of `kind` beside, above or below `cell` (or the whole grid's edge when none is named);
 * on a cell's middle it takes that cell's chart's place. False when there was no room or nothing
 * to take the place of.
 */
export function dockKind(api: DockviewApi, kind: ChartKind, position: keyof typeof DIRECTION | "center", cell?: Cell): boolean {
  if (position === "center") {
    const target = cell?.activePanel;
    if (!target) return false;
    replaceChart(api, target.id, kind);
  } else {
    if (!canDock(api, position)) return false;
    const pick = readPick();
    const panel = api.addPanel({
      id: nextId(kind),
      component: kind,
      title: kind === "deltaoi" ? deltaTitle(pick) : kind === "straddle" ? titleOf(pick) : "Chart",
      params: kind === "scrip" ? { id: pick?.underlying.id } : { pick },
      position: cell ? { referenceGroup: cell, direction: DIRECTION[position] } : { direction: DIRECTION[position] },
    });
    panel.api.setActive();
  }
  // Settled before it is measured.
  syncSoon(api);
  return true;
}

/** A kind of cell dropped on the grid from the side panel (what its header's drag carries). */
export function dockDropped(api: DockviewApi, event: DockviewDidDropEvent): boolean {
  const kind = event.nativeEvent.dataTransfer?.getData(DOCK_DRAG);
  return isChartKind(kind) && dockKind(api, kind, event.position, event.group);
}

/* -- saving and restoring ----------------------------------------------------------------------- */

export const deskState = (api: DockviewApi): DeskState => ({ v: 2, arrangement, dock: api.toJSON() });

/** Every cell one chart of a kind the grid draws: a desk this version saved. */
const valid = (api: DockviewApi) =>
  api.panels.length > 0 && api.groups.length <= 4 && api.groups.every((g) => g.panels.length === 1) && api.panels.every((p) => isChartKind(p.api.component));

interface SerialNode {
  type?: string;
  data?: unknown;
}

/** The charts of a desk the old tabbed layout saved, container by container in reading order. */
function legacySpecs(layout: unknown): ChartSpec[] {
  const json = layout as { grid?: { root?: SerialNode }; panels?: Record<string, { contentComponent?: string; params?: Record<string, unknown>; title?: string }> } | null;
  const panels = json?.panels ?? {};
  const out: ChartSpec[] = [];
  const walk = (node: SerialNode | undefined) => {
    if (!node) return;
    if (node.type === "branch" && Array.isArray(node.data)) {
      for (const kid of node.data as SerialNode[]) walk(kid);
      return;
    }
    const views = (node.data as { views?: string[]; activeView?: string } | undefined)?.views ?? [];
    for (const id of views) {
      const p = panels[id];
      if (p && isChartKind(p.contentComponent)) out.push({ component: p.contentComponent, params: p.params ?? {}, title: p.title });
    }
  };
  walk(json?.grid?.root);
  return out;
}

/** Brings back a saved desk, this version's or the old tabbed one's; false when there is nothing to draw. */
export function loadDesk(api: DockviewApi, saved: unknown): boolean {
  hush(api);
  if (isDesk(saved)) {
    try {
      api.fromJSON(saved.dock as Parameters<DockviewApi["fromJSON"]>[0]);
    } catch {
      api.clear();
    }
    if (valid(api)) {
      // Opens on the whole desk, not on whichever container filled it when it was saved.
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      // A desk saved before panels carried a title strip kept `hideHeader` on every group: shown
      // again here, not just on the next save, so a visit right after the update sees it too.
      for (const g of api.groups) g.header.hidden = false;
      setArrangement(arrangementOf(saved.arrangement).id);
      // A desk saved before the picker followed the cells may name another layout than it draws.
      window.setTimeout(() => syncArrangement(api), 500);
      return true;
    }
  }
  const specs = legacySpecs(isDesk(saved) ? saved.dock : saved);
  if (specs.length === 0) return false;
  const target = arrangementFor(specs.length);
  build(api, target, specs.slice(0, target.count), 0);
  return true;
}

function readSaved(): unknown {
  try {
    const desk = localStorage.getItem(DESK_KEY);
    if (desk) return JSON.parse(desk);
    const legacy = localStorage.getItem(legacyKey(localStorage.getItem(LEGACY_VIEW_KEY)));
    return legacy ? JSON.parse(legacy) : null;
  } catch {
    return null;
  }
}

/** The way out of a page that will not draw: the desk dropped, so it opens on one empty chart. Saved workspaces stay. */
export function forgetLayouts() {
  try {
    localStorage.removeItem(DESK_KEY);
    for (const key of ["mh.layout", "mh.layout.straddle", "mh.layout.chain", LEGACY_VIEW_KEY]) localStorage.removeItem(key);
  } catch {
    // Storage off: nothing was saved to come back.
  }
}

/** One straddle chart on the last pick: a first visit, or a desk that will not come back. */
const opening = (api: DockviewApi) => build(api, arrangementOf("1"), [{ component: "straddle", params: { pick: readPick() } }], 0);

/** A double click on a divider evens the two sides it separates. */
function resetDivider(api: DockviewApi, sash: Element) {
  const s = sash.getBoundingClientRect();
  const vertical = s.height > s.width;
  const near = (a: number, b: number) => Math.abs(a - b) <= 10;
  let first: (typeof api.groups)[number] | undefined;
  let second: (typeof api.groups)[number] | undefined;
  for (const g of api.groups) {
    const r = g.element.getBoundingClientRect();
    if (vertical) {
      const overlaps = r.top < s.bottom && r.bottom > s.top;
      if (overlaps && near(r.right, s.left + s.width / 2)) first ??= g;
      if (overlaps && near(r.left, s.left + s.width / 2)) second ??= g;
    } else {
      const overlaps = r.left < s.right && r.right > s.left;
      if (overlaps && near(r.bottom, s.top + s.height / 2)) first ??= g;
      if (overlaps && near(r.top, s.top + s.height / 2)) second ??= g;
    }
  }
  if (!first || !second) return;
  if (vertical) first.api.setSize({ width: Math.round((first.api.width + second.api.width) / 2) });
  else first.api.setSize({ height: Math.round((first.api.height + second.api.height) / 2) });
}

export function Workspace({
  hub,
  themeKey,
  onApi,
  onDocked,
}: Readonly<{ hub: Hub; themeKey: string; onApi?: (api: DockviewApi) => void; onDocked?: (kind: ChartKind) => void }>) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const docked = useRef(onDocked);
  docked.current = onDocked;

  const ready = (event: DockviewReadyEvent) => {
    setApi(event.api);
    onApi?.(event.api);
    // StrictMode mounts twice in development; a second restore would add every chart again.
    if (event.api.panels.length > 0) return;
    if (!loadDesk(event.api, readSaved())) opening(event.api);
  };

  // Saved as it changes, coalesced.
  useEffect(() => {
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(DESK_KEY, JSON.stringify(deskState(api)));
        } catch {
          // A per-viewer convenience only.
        }
      }, SAVE_DELAY_MS);
    };
    const subscriptions = [api.onDidLayoutChange(save), api.onDidActivePanelChange(save)];
    return () => {
      if (timer) clearTimeout(timer);
      for (const each of subscriptions) each.dispose();
    };
  }, [api]);

  // Cells are moved by their tabs, and Delta × OI is dragged in from the side panel's header.
  useEffect(() => {
    if (!api) return;
    const subscriptions = [
      // A cell is one chart: a tab dropped on another cell's middle would stack the two, so only
      // the edges (which open a cell beside, above or below) take a cell that is being moved.
      api.onWillShowOverlay((e) => {
        if (e.position === "center" && e.getData()) e.preventDefault();
      }),
      // A drag from the side panel is taken where there is room for it.
      api.onUnhandledDragOverEvent((e) => {
        if (e.nativeEvent.dataTransfer?.types.includes(DOCK_DRAG) && canDock(api, e.position)) e.accept();
      }),
      api.onDidDrop((e) => {
        const kind = e.nativeEvent.dataTransfer?.getData(DOCK_DRAG);
        if (isChartKind(kind) && dockDropped(api, e)) docked.current?.(kind);
      }),
      // The picker names the layout on screen: after a container is moved, added or closed.
      api.onDidMovePanel(() => syncSoon(api)),
      api.onDidAddGroup(() => syncSoon(api)),
      api.onDidRemoveGroup(() => syncSoon(api)),
    ];
    // Ctrl Shift M: the active container fills the desk, and again gives it back (QuantDesk's key).
    const maximize = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.key.toLowerCase() !== "m") return;
      const panel = api.activePanel;
      if (!panel) return;
      e.preventDefault();
      if (panel.group.api.isMaximized()) panel.group.api.exitMaximized();
      else api.maximizeGroup(panel);
    };
    window.addEventListener("keydown", maximize);
    return () => {
      window.removeEventListener("keydown", maximize);
      for (const each of subscriptions) each.dispose();
    };
  }, [api]);

  // Rows and columns even out as cells come and go, and glide to where they land (QuantDesk's).
  useEffect(() => (api ? installDockBalance(api) : undefined), [api]);

  // The toolbar follows the active chart.
  useEffect(() => {
    if (!api) return;
    setActivePanel(api.activePanel?.id ?? null);
    const subscription = api.onDidActivePanelChange((panel) => setActivePanel(panel?.id ?? null));
    return () => {
      subscription.dispose();
      setActivePanel(null);
    };
  }, [api]);

  // A click anywhere on a chart makes it the active one, canvas and legend alike: a chart that does
  // not take the focus would otherwise leave the toolbar on the last one.
  useEffect(() => {
    const el = host.current;
    if (!api || !el) return;
    const activate = (e: PointerEvent) => {
      const cell = (e.target as Element | null)?.closest(".dv-groupview");
      const group = cell ? api.groups.find((g) => g.element === cell || g.element.contains(cell)) : undefined;
      if (group?.activePanel && !group.activePanel.api.isActive) group.activePanel.api.setActive();
    };
    el.addEventListener("pointerdown", activate, true);
    return () => el.removeEventListener("pointerdown", activate, true);
  }, [api]);

  // An emptied grid is never left blank.
  useEffect(() => {
    if (!api) return;
    const subscription = api.onDidRemovePanel(() => {
      if (api.panels.length === 0) queueMicrotask(() => api.panels.length === 0 && opening(api));
    });
    return () => subscription.dispose();
  }, [api]);

  // A new cell fades in once when it is made (styles: `.mh-entering`).
  useEffect(() => {
    if (!api) return;
    const subscription = api.onDidAddGroup((group) => {
      const element = group.element;
      element.classList.add("mh-entering");
      window.setTimeout(() => element.classList.remove("mh-entering"), 400);
    });
    return () => subscription.dispose();
  }, [api]);

  // A double click on a divider evens the two sides.
  useEffect(() => {
    const el = host.current;
    if (!api || !el) return;
    const onDouble = (e: Event) => {
      const sash = (e.target as Element | null)?.closest(".dv-sash");
      if (sash) resetDivider(api, sash);
    };
    el.addEventListener("dblclick", onDouble);
    return () => el.removeEventListener("dblclick", onDouble);
  }, [api]);

  // Chrome was seen leaving a stale, too-wide layout after exiting fullscreen (a horizontal
  // scrollbar on a page that never otherwise has one), so the dock is told its host's real size
  // once the transition settles.
  useEffect(() => {
    if (!api) return;
    const relayout = () => {
      requestAnimationFrame(() => {
        const el = host.current;
        if (el) api.layout(el.clientWidth, el.clientHeight, true);
      });
    };
    document.addEventListener("fullscreenchange", relayout);
    return () => document.removeEventListener("fullscreenchange", relayout);
  }, [api]);

  return (
    <Desk.Provider value={{ hub, themeKey }}>
      <div ref={host} className="mh-dock-host">
        <DockviewReact
          components={COMPONENTS}
          defaultTabComponent={DeskTab}
          leftHeaderActionsComponent={AddContainer}
          rightHeaderActionsComponent={ContainerActions}
          onReady={ready}
          className="mh-dock dockview-theme-dark"
        />
        {api && (
          <DropMap
            api={api}
            host={host}
            place={(kind, where, cell) => {
              const done = dockKind(api, kind, where, cell);
              if (done) docked.current?.(kind);
              return done;
            }}
          />
        )}
      </div>
    </Desk.Provider>
  );
}
