/**
 * The arrangements the Charts page offers, as TradingView's layout menu does: from one chart to six,
 * each a tree of splits. A split runs its children along a row or a column, each with a weight, and
 * the gutters between them are dragged to change the weights. A leaf is a container; leaves are
 * numbered in reading order, which is also the order of the cells in a saved layout.
 */
export type Kind = "price" | "straddle" | "deltaoi"

export const KINDS: readonly { value: Kind; label: string; hint: string }[] = [
  { value: "price", label: "Price chart", hint: "Candles with the OI profile over them" },
  { value: "straddle", label: "Straddle", hint: "The at-the-money straddle, with implied vol and India VIX" },
  { value: "deltaoi", label: "Delta × OI", hint: "Delta-weighted open interest, strike by strike" },
]

/**
 * `shared` marks a grid: its children are rows (or columns) that keep the same proportions, so dragging
 * a divider in one moves it in all and the cells stay aligned.
 */
export type Node = { leaf: number } | { dir: "row" | "col"; weights: number[]; kids: Node[]; shared?: boolean }

type Spec = "x" | { dir: "row" | "col"; weights: number[] | null; kids: Spec[]; shared?: boolean }

const x = "x" as const
const row = (weights: number[] | null, ...kids: Spec[]): Spec => ({ dir: "row", weights, kids })
const col = (weights: number[] | null, ...kids: Spec[]): Spec => ({ dir: "col", weights, kids })
const grid = (...rows: Spec[]): Spec => ({ dir: "col", weights: null, kids: rows, shared: true })

function build(spec: Spec, next = { n: 0 }): Node {
  if (spec === "x") return { leaf: next.n++ }
  return { dir: spec.dir, weights: spec.weights ?? spec.kids.map(() => 1), kids: spec.kids.map((k) => build(k, next)), ...(spec.shared ? { shared: true } : {}) }
}

export interface Preset {
  id: string
  name: string
  count: number
  tree: Node
}

export interface PresetGroup {
  title: string
  presets: readonly Preset[]
}

const make = (id: string, name: string, spec: Spec): Preset => {
  const tree = build(spec)
  return { id, name, count: leaves(tree), tree }
}

export function leaves(node: Node): number {
  return "leaf" in node ? 1 : node.kids.reduce((n, k) => n + leaves(k), 0)
}

export const PRESET_GROUPS: readonly PresetGroup[] = [
  { title: "One chart", presets: [make("1", "One chart", x)] },
  {
    title: "Two charts",
    presets: [make("2c", "Two side by side", row(null, x, x)), make("2r", "Two stacked", col(null, x, x))],
  },
  {
    title: "Three charts",
    presets: [
      make("3c", "Three side by side", row(null, x, x, x)),
      make("3r", "Three stacked", col(null, x, x, x)),
      make("3l", "Large left, two right", row([3, 2], x, col(null, x, x))),
      make("3g", "Two left, large right", row([2, 3], col(null, x, x), x)),
      make("3t", "Large top, two below", col([3, 2], x, row(null, x, x))),
      make("3b", "Two above, large bottom", col([2, 3], row(null, x, x), x)),
    ],
  },
  {
    title: "Four charts",
    presets: [
      make("4g", "Two by two", grid(row(null, x, x), row(null, x, x))),
      make("4c", "Four side by side", row(null, x, x, x, x)),
      make("4r", "Four stacked", col(null, x, x, x, x)),
      make("4l", "Large left, three right", row([2, 1], x, col(null, x, x, x))),
      make("4g2", "Three left, large right", row([1, 2], col(null, x, x, x), x)),
      make("4t", "Large top, three below", col([2, 1], x, row(null, x, x, x))),
      make("4b", "Three above, large bottom", col([1, 2], row(null, x, x, x), x)),
    ],
  },
  {
    title: "Six charts",
    presets: [
      make("6w", "Three by two", grid(row(null, x, x, x), row(null, x, x, x))),
      make("6t", "Two by three", grid(row(null, x, x), row(null, x, x), row(null, x, x))),
    ],
  },
]

export const PRESETS: readonly Preset[] = PRESET_GROUPS.flatMap((g) => g.presets)
export const PRESET_BY_ID: ReadonlyMap<string, Preset> = new Map(PRESETS.map((p) => [p.id, p]))

/** A split's address in the tree: "" for the root, "1" for its second child, "1.0" for that child's first. */
export const childPath = (path: string, i: number) => (path ? `${path}.${i}` : String(i))

/**
 * Where a split's own weights are kept: at its address, except for the children of a grid, which all
 * keep theirs at the first child's, so they are one set of weights.
 */
export const sizeKey = (parent: Node | null, path: string, i: number) => (parent && !("leaf" in parent) && parent.shared ? childPath(path, 0) : childPath(path, i))

/** The preset's tree with the weights the viewer has dragged them to, where those still fit. `key` is where this node's own weights are kept. */
export function resolve(node: Node, sizes: Readonly<Record<string, number[]>>, path = "", key = path): Node {
  if ("leaf" in node) return node
  const own = sizes[key]
  const weights = own && own.length === node.weights.length && own.every((w) => Number.isFinite(w) && w > 0) ? own : node.weights
  return { ...node, weights, kids: node.kids.map((k, i) => resolve(k, sizes, childPath(path, i), sizeKey(node, path, i))) }
}

export interface Cell {
  leaf: number
  x: number
  y: number
  w: number
  h: number
}

/** Where each leaf falls in a w by h box with `gap` between neighbours, on whole pixels (for the layout's picture). */
export function cells(node: Node, w: number, h: number, gap: number, x0 = 0, y0 = 0): Cell[] {
  if ("leaf" in node) {
    const x1 = Math.round(x0)
    const y1 = Math.round(y0)
    return [{ leaf: node.leaf, x: x1, y: y1, w: Math.round(x0 + w) - x1, h: Math.round(y0 + h) - y1 }]
  }
  const total = node.weights.reduce((a, b) => a + b, 0)
  const row = node.dir === "row"
  const room = (row ? w : h) - gap * (node.kids.length - 1)
  let at = row ? x0 : y0
  return node.kids.flatMap((kid, i) => {
    const len = (room * node.weights[i]!) / total
    const out = row ? cells(kid, len, h, gap, at, y0) : cells(kid, w, len, gap, x0, at)
    at += len + gap
    return out
  })
}
