import { useEffect, useState, type DragEvent, type RefObject } from "react";
import { positionToDirection, type DockviewApi, type Position } from "dockview";

import { DropArrowIcon, DropReplaceIcon } from "../ui/icons";
import { sideDragKind } from "./dockDrag";
import type { ChartKind } from "./Workspace";
import "./dropMap.css";

/**
 * Every place a dragged container can go, shown while it is dragged: QuantDesk's drop map
 * (shell/DropMap.tsx there, from Kite's desk), on this desk's cells.
 *
 * The moment a cell's tab (or a side panel's header) starts to drag, every other cell gets a
 * dashed outline and its own drop slots:
 *
 *   - an arrow on each of its four sides: split it, taking that half;
 *   - on a drag from the side panel, a window in its middle: take that chart's place;
 *   - an arrow on each outer edge of the whole desk: a new full row or column.
 *
 * Each slot is a real drop target: pointing at one shows the area it will take, and letting go
 * there moves the container. Anywhere else, dockview's own drop overlay works as before; the slots
 * only add explicit targets on top of it. A cell is one chart, so a moved cell has no "join as a
 * tab" slot (the cell's own middle is dockview's, and refused). The map is measured once when the
 * drag starts, since the layout cannot change mid-drag, and drawn with no work per pointer move.
 */

/** A cell being moved (by its tab, or its group's empty header), or a new one coming from the side panel. */
type Source = { kind: "panel" | "group"; id: string } | { kind: "new"; component: ChartKind };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Slot extends Rect {
  key: string;
  /** The cell it drops into; null for an edge of the whole desk. */
  group: string | null;
  where: Position;
  /** What the slot gives the container, drawn while the pointer is on it. */
  area: Rect;
}

interface DropLayout {
  boxes: (Rect & { id: string })[];
  slots: Slot[];
}

/** The replace-here slot. */
const MIDDLE = { w: 30, h: 20 };
/** A side slot of a cell. */
const SIDE = { w: 34, h: 20 };
/** A slot on the outer edge of the desk. */
const EDGE = { w: 48, h: 16 };
/** How far side slots sit in from a cell's edge. */
const INSET = 8;
/** The most cells the layout picker has: a new cell has no room past it. */
const MOST_CELLS = 4;

function measure(api: DockviewApi, host: HTMLElement, source: Source): DropLayout {
  const frame = host.getBoundingClientRect();
  const W = frame.width;
  const H = frame.height;
  const boxes: DropLayout["boxes"] = [];
  const slots: Slot[] = [];
  const own = source.kind === "panel" ? api.getPanel(source.id)?.group.id : source.kind === "group" ? source.id : undefined;
  // A moved cell leaves the count as it was; a new one adds to it.
  const roomForMore = source.kind !== "new" || api.groups.length < MOST_CELLS;
  /** The top row's header height: the desk's top slot sits just under it, never on a tab. */
  let topHeader = 0;
  /** The tallest content stretch touching each side of the desk: its left and right slots sit in it, never on a header. */
  const sideRun: Record<"left" | "right", { y: number; h: number } | null> = { left: null, right: null };

  for (const group of api.groups) {
    if (group.api.location.type !== "grid" || !group.api.isVisible) continue;
    const r = group.element.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) continue;
    const box = { id: group.id, x: r.left - frame.left, y: r.top - frame.top, w: r.width, h: r.height };
    boxes.push(box);

    const header = group.element.querySelector(".dv-tabs-and-actions-container")?.getBoundingClientRect();
    const headerH = header ? header.height : 28;
    if (box.y < 1) topHeader = Math.max(topHeader, headerH);

    const content: Rect = { x: box.x, y: box.y + headerH, w: box.w, h: box.h - headerH };
    for (const side of ["left", "right"] as const) {
      const touches = side === "left" ? box.x < 1 : box.x + box.w > W - 1;
      const run = sideRun[side];
      if (touches && (!run || content.h > run.h)) sideRun[side] = { y: content.y, h: content.h };
    }
    // A cell cannot be dropped into itself: nothing is offered on the one being moved.
    if (group.id === own) continue;

    const roomy = content.w >= SIDE.w * 3 + INSET * 2 && content.h >= SIDE.h * 3 + INSET * 2;
    const clear = (edge: boolean) => INSET + (edge ? EDGE.h + 6 : 0);
    const atTop = box.y < 1;
    const atBottom = box.y + box.h > H - 1;
    const atLeft = box.x < 1;
    const atRight = box.x + box.w > W - 1;

    // A new cell can take a chart's place; a moved one cannot (that would stack two in a cell).
    if (source.kind === "new") {
      slots.push({
        key: `${group.id}:center`,
        group: group.id,
        where: "center",
        x: content.x + content.w / 2 - MIDDLE.w / 2,
        y: content.y + content.h / 2 - MIDDLE.h / 2,
        w: MIDDLE.w,
        h: MIDDLE.h,
        area: content,
      });
    }

    // Side slots only where they fit without crowding each other — and a side
    // on the desk's own edge keeps clear of the desk's slot there. The middle slot
    // (a new cell's) takes the centre, so the four sit round it, not on it.
    if (!roomy || !roomForMore) continue;
    const midX = content.x + content.w / 2 - SIDE.w / 2;
    const midY = content.y + content.h / 2 - SIDE.h / 2;
    const half = { w: content.w / 2, h: content.h / 2 };
    const sides: [Position, number, number, Rect][] = [
      ["top", midX, content.y + clear(atTop), { ...content, h: half.h }],
      ["bottom", midX, content.y + content.h - clear(atBottom) - SIDE.h, { ...content, y: content.y + half.h, h: half.h }],
      ["left", content.x + clear(atLeft), midY, { ...content, w: half.w }],
      ["right", content.x + content.w - clear(atRight) - SIDE.w, midY, { ...content, x: content.x + half.w, w: half.w }],
    ];
    for (const [where, x, y, area] of sides) slots.push({ key: `${group.id}:${where}`, group: group.id, where, x, y, w: SIDE.w, h: SIDE.h, area });
  }

  // The desk's own edges: a new row or column across the whole of it. The top
  // one sits just under the top row's tabs, so it never covers a header.
  if (roomForMore) {
    const band = { w: Math.min(W * 0.3, 480), h: Math.min(H * 0.3, 320) };
    const middleOf = (run: { y: number; h: number } | null) => (run ? run.y + run.h / 2 : (H + topHeader) / 2) - EDGE.w / 2;
    const edges: [Position, number, number, Rect][] = [
      ["top", W / 2 - EDGE.w / 2, topHeader + 2, { x: 0, y: 0, w: W, h: band.h }],
      ["bottom", W / 2 - EDGE.w / 2, H - EDGE.h - 2, { x: 0, y: H - band.h, w: W, h: band.h }],
      ["left", 2, middleOf(sideRun.left), { x: 0, y: 0, w: band.w, h: H }],
      ["right", W - EDGE.h - 2, middleOf(sideRun.right), { x: W - band.w, y: 0, w: band.w, h: H }],
    ];
    for (const [where, x, y, area] of edges) {
      const upright = where === "left" || where === "right";
      slots.push({ key: `desk:${where}`, group: null, where, x, y, w: upright ? EDGE.h : EDGE.w, h: upright ? EDGE.w : EDGE.h, area });
    }
  }
  return { boxes, slots };
}

/** What letting go on a slot does, said on the area it will take. */
function caption(slot: Slot, source: Source): string {
  if (slot.group === null) return slot.where === "top" || slot.where === "bottom" ? `New row at the ${slot.where}` : `New column at the ${slot.where}`;
  if (slot.where === "center") return "Take this chart's place";
  return source.kind === "new" ? `Dock ${slot.where}` : `Move ${slot.where}`;
}

export function DropMap({
  api,
  host,
  place,
}: Readonly<{
  api: DockviewApi;
  host: RefObject<HTMLElement | null>;
  /** Makes a new cell of a kind where a slot says (`Workspace`'s `dockKind`); false when it could not. */
  place: (kind: ChartKind, where: Position, cell?: DockviewApi["groups"][number]) => boolean;
}>) {
  const [source, setSource] = useState<Source | null>(null);
  const [layout, setLayout] = useState<DropLayout | null>(null);
  const [hot, setHot] = useState<string | null>(null);

  useEffect(() => {
    let current: Source | null = null;
    let frame = 0;
    let faded: HTMLElement | null = null;

    const begin = (next: Source) => {
      current = next;
      cancelAnimationFrame(frame);
      // Next frame: the drag image is taken from the page as it is now, and
      // the map must not be in it.
      frame = requestAnimationFrame(() => {
        const element = host.current;
        if (current !== next || !element) return;
        document.documentElement.toggleAttribute("data-mh-drop-map", true);
        // The cell that is leaving fades, so it is clear which one is moving.
        if (next.kind !== "new") {
          faded = (next.kind === "panel" ? api.getPanel(next.id)?.group : api.getGroup(next.id))?.element ?? null;
          faded?.classList.add("mh-drag-source");
        }
        setSource(next);
        setLayout(measure(api, element, next));
      });
    };
    const end = () => {
      if (current === null) return;
      current = null;
      cancelAnimationFrame(frame);
      document.documentElement.toggleAttribute("data-mh-drop-map", false);
      faded?.classList.remove("mh-drag-source");
      faded = null;
      setSource(null);
      setLayout(null);
      setHot(null);
    };

    const panelDrag = api.onWillDragPanel((event) => begin({ kind: "panel", id: event.panel.id }));
    const groupDrag = api.onWillDragGroup((event) => begin({ kind: "group", id: event.group.id }));
    // A side panel's header drag (dockDrag.ts) is ours, not dockview's. Bubble phase, so the
    // header's own handler has already recorded the kind.
    const headerDrag = (event: globalThis.DragEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-panel-drag-handle]")) return;
      const component = sideDragKind();
      if (component) begin({ kind: "new", component });
    };

    window.addEventListener("dragstart", headerDrag);
    // A drop anywhere (bubble: after a slot has handled its own), a drag ended or cancelled,
    // and — should the source have left the page mid-drag — the next press all end the map.
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end, true);
    window.addEventListener("pointerdown", end, true);
    return () => {
      end();
      panelDrag.dispose();
      groupDrag.dispose();
      window.removeEventListener("dragstart", headerDrag);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end, true);
      window.removeEventListener("pointerdown", end, true);
      cancelAnimationFrame(frame);
    };
  }, [api, host]);

  if (!layout || !source) return null;

  /** Moves the dragged cell, or docks the new one, where `slot` says. */
  const land = (slot: Slot) => {
    const target = slot.group ? api.getGroup(slot.group) : undefined;
    if (slot.group && !target) return;

    if (source.kind === "new") {
      place(source.component, slot.where, target);
      return;
    }
    const moving = source.kind === "panel" ? api.getPanel(source.id) : api.getGroup(source.id)?.activePanel;
    if (!moving || slot.where === "center") return;
    if (target) {
      moving.api.moveTo({ group: target, position: slot.where });
    } else {
      // To an edge of the whole desk: a new group there, the cell in it.
      const group = api.addGroup({ direction: positionToDirection(slot.where) });
      moving.api.moveTo({ group, position: "center" });
    }
    moving.api.setActive();
  };

  const over = (slot: Slot) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (hot !== slot.key) setHot(slot.key);
  };
  const drop = (slot: Slot) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    land(slot);
  };
  const hotSlot = layout.slots.find((slot) => slot.key === hot);

  return (
    <div className="mh-drop-map" aria-hidden>
      {layout.boxes.map((box) => (
        <div key={box.id} className="mh-drop-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      ))}
      {hotSlot && (
        <div className="mh-drop-area" style={{ left: hotSlot.area.x, top: hotSlot.area.y, width: hotSlot.area.w, height: hotSlot.area.h }}>
          <span>{caption(hotSlot, source)}</span>
        </div>
      )}
      {layout.slots.map((slot) => (
        <div
          key={slot.key}
          className={`mh-drop-slot${slot.key === hot ? " hot" : ""}${slot.group ? "" : " edge"}`}
          style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h }}
          onDragEnter={over(slot)}
          onDragOver={over(slot)}
          onDragLeave={() => setHot((current) => (current === slot.key ? null : current))}
          onDrop={drop(slot)}
        >
          {slot.where === "center" ? <DropReplaceIcon /> : <DropArrowIcon where={slot.where} />}
        </div>
      ))}
    </div>
  );
}
