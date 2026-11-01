import type { KeyboardEvent, PointerEvent } from "react";

/** The step an arrow key moves a panel's edge by. */
const KEY_STEP = 16;

/**
 * The same edge from the keyboard: with the grip focused, the arrows move it a step at a time (the
 * ones that grow the panel and the ones that shrink it, by `sign` as for the drag).
 */
export function edgeKeys(e: KeyboardEvent<HTMLElement>, axis: "x" | "y", sign: 1 | -1, size: number, min: number, max: number, onSize: (size: number) => void) {
  const keys = axis === "x" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
  const dir = keys[e.key as keyof typeof keys];
  if (dir === undefined) return;
  e.preventDefault();
  onSize(Math.min(max, Math.max(min, size + sign * dir * KEY_STEP)));
}

/**
 * A panel resized by dragging its edge: the side panel's left edge, the bottom panel's top one.
 * `sign` is -1 where the panel grows as the pointer moves left or up. The size moves in whole
 * pixels, so the panel's edges and everything laid against them stay on the pixel grid.
 */
export function edgeDrag(e: PointerEvent<HTMLElement>, axis: "x" | "y", sign: 1 | -1, start: number, min: number, max: number, onSize: (size: number) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  const origin = axis === "x" ? e.clientX : e.clientY;
  document.documentElement.dataset.resizing = axis;
  const move = (m: globalThis.PointerEvent) => {
    const delta = (axis === "x" ? m.clientX : m.clientY) - origin;
    onSize(Math.round(Math.min(max, Math.max(min, start + sign * delta))));
  };
  const end = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    delete document.documentElement.dataset.resizing;
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}
