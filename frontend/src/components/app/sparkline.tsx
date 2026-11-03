import { toneOf } from "@/lib/format"
import { cn } from "@/lib/utils"

const STROKE: Record<ReturnType<typeof toneOf>, string> = {
  up: "stroke-up",
  down: "stroke-down",
  flat: "stroke-subtle",
}

/**
 * The session's closes as one line, with the previous close as a dashed reference. Plain SVG:
 * stretched to its box with a non-scaling stroke, so the line stays 1.5 px and crisp at any width.
 */
export function Sparkline({ points, reference, className }: { points: readonly number[]; reference: number | null; className?: string }) {
  const H = 40
  if (points.length < 2) return <div className={cn("h-10 w-full", className)} aria-hidden />

  const values = reference !== null ? [...points, reference] : [...points]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const y = (v: number) => 3 + (1 - (v - min) / span) * (H - 6)
  const last = points[points.length - 1]!
  const tone = reference !== null ? toneOf(last - reference) : "flat"
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * 100).toFixed(2)} ${y(v).toFixed(2)}`).join("")

  return (
    <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className={cn("h-10 w-full overflow-visible", className)} aria-hidden>
      {reference !== null ? <line x1="0" x2="100" y1={y(reference)} y2={y(reference)} className="stroke-border" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
      <path d={d} fill="none" className={STROKE[tone]} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
