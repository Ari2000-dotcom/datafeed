import { cn } from "@/lib/utils"

/** The bar under the strip that names a screen and holds its controls. Titles stay at 16 px. */
export function PageHeader({ title, note, children, className }: { title: string; note?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-chrome px-6 py-2", className)}>
      <div className="flex items-baseline gap-3">
        <h1 className="type-title">{title}</h1>
        {note ? <span className="type-meta">{note}</span> : null}
      </div>
      {children}
    </div>
  )
}
