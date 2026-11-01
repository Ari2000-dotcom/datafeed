/**
 * The chart layouts of the top toolbar's layout picker, TradingView's way: one to four charts, each
 * arrangement with its picture, the cells' rectangles (x, y, w, h as fractions of the grid) in
 * reading order. Cell i of a layout is the i-th chart in reading order, so switching layouts keeps
 * the charts in place as far as the new one has room.
 */

export type ArrangementId = "1" | "2v" | "2h" | "3v" | "1l2r" | "1t2b" | "2x2" | "1l3r";

export type Rect = readonly [x: number, y: number, w: number, h: number];

export interface Arrangement {
  id: ArrangementId;
  name: string;
  count: number;
  rects: readonly Rect[];
}

const third = 1 / 3;

export const ARRANGEMENTS: readonly Arrangement[] = [
  { id: "1", name: "One chart", count: 1, rects: [[0, 0, 1, 1]] },
  { id: "2v", name: "Two side by side", count: 2, rects: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: "2h", name: "Two stacked", count: 2, rects: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: "3v", name: "Three side by side", count: 3, rects: [[0, 0, third, 1], [third, 0, third, 1], [2 * third, 0, third, 1]] },
  { id: "1l2r", name: "One left, two right", count: 3, rects: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: "1t2b", name: "One above, two below", count: 3, rects: [[0, 0, 1, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: "2x2", name: "Four in a grid", count: 4, rects: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: "1l3r", name: "One left, three right", count: 4, rects: [[0, 0, 0.5, 1], [0.5, 0, 0.5, third], [0.5, third, 0.5, third], [0.5, 2 * third, 0.5, third]] },
];

export const arrangementOf = (id: string | undefined): Arrangement => ARRANGEMENTS.find((a) => a.id === id) ?? ARRANGEMENTS[0]!;

/** The layout a saved desk of `count` charts comes back in when it names none. */
export const arrangementFor = (count: number): Arrangement =>
  count >= 4 ? arrangementOf("2x2") : count === 3 ? arrangementOf("1l2r") : count === 2 ? arrangementOf("2v") : arrangementOf("1");
