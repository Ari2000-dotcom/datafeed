import { useLayoutEffect, useState } from "react"

/**
 * Keeps a toolbar on its one line by hiding its least-needed pieces, measured rather than guessed
 * from breakpoints: a longer instrument name or a narrower container only changes what fits, never
 * wraps the bar onto a second row.
 *
 * Every element in the row marked `data-drop="n"` can give way, the lowest `n` first, all of one rank
 * together. A pass hides rank by rank while the row overflows, then gives back any rank hidden on the
 * way that fits the room left over. It runs when the row, its parent or one of its groups changes
 * size (a splitter drag, a label that changed), not on every render: a chart re-renders on each tick.
 *
 * Returns the ref callback to put on the row.
 */
export function useFitRow(): (row: HTMLElement | null) => void {
  const [row, setRow] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!row) return
    fit(row)
    const observer = new ResizeObserver(() => refit(row))
    observer.observe(row)
    // The row's direct groups grow when a label inside them changes; a newly mounted piece grows its group too.
    for (const group of row.children) observer.observe(group)
    return () => observer.disconnect()
  }, [row])

  return setRow
}

/** A one-line row overflows when its content, or that of one of its groups (a group may shrink and clip), is wider than its box. */
const spills = (row: HTMLElement): boolean => row.scrollWidth > row.clientWidth + 1 || [...row.children].some((g) => g.scrollWidth > g.clientWidth + 1)

const rankOf = (piece: HTMLElement) => Number(piece.dataset.drop)

function piecesOf(row: HTMLElement) {
  const pieces = [...row.querySelectorAll<HTMLElement>("[data-drop]")]
  const ranks = [...new Set(pieces.map(rankOf))].sort((a, b) => a - b)
  const setHidden = (rank: number, hidden: boolean) => {
    for (const piece of pieces) if (rankOf(piece) === rank) piece.hidden = hidden
  }
  return { pieces, ranks, setHidden }
}

/** Once the row fits, each rank hidden before the last one that had to go gets one try back, most needed first. */
function backfill(gone: readonly number[], setHidden: (rank: number, hidden: boolean) => void, row: HTMLElement): void {
  for (const rank of [...gone].reverse()) {
    setHidden(rank, false)
    if (spills(row)) setHidden(rank, true)
  }
}

/** From nothing hidden. */
function fit(row: HTMLElement): void {
  const { pieces, ranks, setHidden } = piecesOf(row)
  for (const piece of pieces) piece.hidden = false
  let over = spills(row)
  const gone: number[] = []
  for (const rank of ranks) {
    if (!over) break
    setHidden(rank, true)
    gone.push(rank)
    over = spills(row)
  }
  if (!over) backfill(gone.slice(0, -1), setHidden, row)
}

/**
 * From what is hidden now: a splitter drag sends a resize every frame, and showing every piece only
 * to hide them again would cost a layout per rank on each one. A frame that changes nothing costs a
 * measurement per hidden rank.
 */
function refit(row: HTMLElement): void {
  const { pieces, ranks, setHidden } = piecesOf(row)
  const hidden = ranks.filter((rank) => pieces.some((p) => rankOf(p) === rank && p.hidden))
  let over = spills(row)
  if (over) {
    let last: number | null = null
    for (const rank of ranks) {
      if (hidden.includes(rank)) continue
      setHidden(rank, true)
      last = rank
      over = spills(row)
      if (!over) break
    }
    if (!over && last !== null) backfill(hidden.filter((rank) => rank < last!), setHidden, row)
  } else {
    // A less needed rank still shown over a more needed one hidden: start over, so the order holds as the row widens.
    const shown = ranks.filter((rank) => !hidden.includes(rank))
    if (hidden.some((h) => shown.some((s) => s < h))) return fit(row)
    backfill(hidden, setHidden, row)
  }
}
