import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * QuantDesk's folder tab over a container: the name on a tab that runs into the plate below it. `aside`
 * sits at the strip's right on the workspace (counts, notes, controls that are about the container but
 * not inside it). `active` frames tab and plate together.
 */
export function FolderTab({
  title,
  count,
  aside,
  active = false,
}: {
  title: ReactNode
  count?: ReactNode
  aside?: ReactNode
  active?: boolean
}) {
  return (
    <div className="folder-strip gap-3">
      <div className="folder-tab" data-active={active || undefined}>
        <span>{title}</span>
        {count !== undefined && count !== "" ? (
          <span className="num text-subtle">{count}</span>
        ) : null}
      </div>
      {aside ? (
        <div className="ml-auto flex min-w-0 items-center gap-3 self-center pr-1 text-[12px]">
          {aside}
        </div>
      ) : null}
    </div>
  )
}

/** A container with its folder tab: the tab, then the plate, its top-left corner square under the tab. */
export function Folder({
  title,
  count,
  aside,
  active,
  className,
  plateClassName,
  children,
  labelledBy,
}: {
  title: ReactNode
  count?: ReactNode
  aside?: ReactNode
  active?: boolean
  className?: string
  plateClassName?: string
  children: ReactNode
  labelledBy?: string
}) {
  return (
    <section aria-labelledby={labelledBy} className={cn("flex min-w-0 flex-col", className)}>
      <FolderTab title={title} count={count} aside={aside} active={active} />
      <div
        data-active={active || undefined}
        className={cn("panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-tl-none bg-card", plateClassName)}
      >
        {children}
      </div>
    </section>
  )
}
