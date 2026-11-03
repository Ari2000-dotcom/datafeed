import { useMemo } from "react"

import { cells, type Node } from "@/lib/layouts"
import { cn } from "@/lib/utils"

/**
 * A layout's picture: the same tree the page lays its containers out by, drawn as outlined boxes with
 * a gap between them, on the 28px grid the chart toolbar's icons use. Every edge falls on a whole
 * pixel, so the outlines are one solid pixel wide at 1x.
 */
export function LayoutGlyph({ tree, className }: { tree: Node; className?: string }) {
  const boxes = useMemo(() => cells(tree, 20, 18, 2, 4, 5), [tree])
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden className={cn("shrink-0", className)}>
      {boxes.map((c) => (
        <rect key={c.leaf} x={c.x + 0.5} y={c.y + 0.5} width={Math.max(1, c.w - 1)} height={Math.max(1, c.h - 1)} rx="1.5" />
      ))}
    </svg>
  )
}
