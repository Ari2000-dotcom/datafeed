import type { DragEvent } from "react";

import type { ChartKind } from "./Workspace";

/**
 * A panel dragged out of the side rail onto the chart grid (QuantDesk's `components/dockDrag.ts`,
 * pared to what this desk has: the side panel's header is the one handle, and Delta × OI the one
 * kind it carries).
 *
 * Dockview keeps its own drag payload private, so a drag from outside carries its own MIME type:
 * dockview sees it as an "unhandled" drag, `Workspace` accepts it and docks the cell where it
 * is dropped, and the drop map (`DropMap.tsx`) offers explicit places for it on top.
 */

/** What the drag's data is filed under. */
export const DOCK_DRAG = "application/x-mh-panel";

/** The kind being dragged, while one is. Only one drag exists at a time. */
let dragging: ChartKind | null = null;

/** The kind of cell a side-panel drag in progress would make, or null. */
export const sideDragKind = (): ChartKind | null => dragging;

/**
 * Starts a side-panel drag: files the kind under `DOCK_DRAG` and swaps the drag image for a small
 * chip naming it, the shape of a tab, instead of a snapshot of the whole header row.
 */
export function beginSideDrag(event: DragEvent<HTMLElement>, kind: ChartKind, title: string) {
  dragging = kind;
  event.dataTransfer.setData(DOCK_DRAG, kind);
  event.dataTransfer.setData("text/plain", title);
  event.dataTransfer.effectAllowed = "move";
  const ghost = document.createElement("div");
  ghost.className = "mh-drag-ghost";
  ghost.textContent = title;
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, 12, 14);
  // The browser copies the image when it is set, so the element can go as soon as this returns.
  setTimeout(() => ghost.remove(), 0);
}

export function endSideDrag() {
  dragging = null;
}
