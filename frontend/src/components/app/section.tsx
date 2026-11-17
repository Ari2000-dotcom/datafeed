import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * A page section in Aperiodic's manner: no tab and no frame around the heading, only a small orange
 * square, the name, a count, and whatever belongs to the section at the right; the content sits on one
 * flat plate underneath. Sections are told apart by a hairline and the space around them.
 */
export function Section({
  title,
  count,
  aside,
  className,
  plateClassName,
  children,
  flush = false,
}: {
  title: ReactNode
  count?: ReactNode
  aside?: ReactNode
  className?: string
  plateClassName?: string
  children: ReactNode
  /** The content draws its own surface (a table or a chart): no plate behind it. */
  flush?: boolean
}) {
  return (
    <section className={cn("flex min-w-0 flex-col", className)}>
      <header className="mb-2.5 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className="size-1.5 shrink-0 bg-primary" />
        <h2 className="type-eyebrow">{title}</h2>
        {count !== undefined && count !== "" ? (
          <span className="num type-meta">{count}</span>
        ) : null}
        {aside ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3 text-[12px] max-sm:w-full sm:ml-auto">
            {aside}
          </div>
        ) : null}
      </header>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          flush ? "" : "plate",
          plateClassName
        )}
      >
        {children}
      </div>
    </section>
  )
}
