import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/*
 * The chart toolbar's parts, TradingView's manner: flat. A control has no border and no fill until
 * the pointer is on it or it is the chosen one, when it takes the one raised surface. Groups are
 * told apart by a hairline between them, not by boxes round them.
 */

const TOOL =
  "inline-flex h-8 min-w-8 shrink-0 whitespace-nowrap items-center justify-center gap-1 rounded-md px-1.5 text-sm font-normal text-soft outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed aria-expanded:bg-accent aria-expanded:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground active:translate-y-px"

/** A flat button: an icon, a word, or both. `active` is the chosen one. */
export function ToolButton({ active, className, ...props }: ComponentProps<"button"> & { active?: boolean }) {
  return <button type="button" data-active={active || undefined} className={cn(TOOL, className)} {...props} />
}

/** A tooltip on whatever it wraps, after a beat: the name of an icon-only control. */
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * One-of-several, QuantDesk's way (Apple's segmented control): a grey track, and under the chosen
 * one a lighter pill that slides to the next when the choice changes. The pill is a layer of its
 * own, so the words on it never move or blur.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T
  onChange: (value: T) => void
  items: readonly { value: T; label: ReactNode; title?: string; disabled?: boolean }[]
  label: string
  className?: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)

  useLayoutEffect(() => {
    const box = track.current
    if (!box) return
    const place = () => {
      const on = box.querySelector<HTMLElement>('[data-state="on"]')
      setPill(on ? { x: on.offsetLeft, w: on.offsetWidth } : null)
    }
    place()
    const watch = new ResizeObserver(place)
    watch.observe(box)
    return () => watch.disconnect()
  }, [value, items.length])

  return (
    <ToggleGroup ref={track} type="single" spacing={0} value={value} onValueChange={(v) => v && onChange(v as T)} aria-label={label} className={cn("relative gap-0 rounded-lg bg-seg-track p-0.5", className)}>
      {pill ? <span aria-hidden className="pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-md bg-seg-pill shadow-sm transition-[transform,width] duration-300 ease-out motion-reduce:transition-none" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} /> : null}
      {items.map((item) => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          title={item.title}
          disabled={item.disabled}
          className="relative h-7 min-w-0 rounded-md bg-transparent px-2.5 text-xs font-medium text-seg-text transition-colors duration-150 outline-none hover:text-seg-hover focus-visible:ring-1 focus-visible:ring-ring data-[state=on]:bg-transparent data-[state=on]:text-seg-active"
        >
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** A hairline between two groups of tools. `drop` lets it give way with the group after it (see useFitRow). */
export function ToolDivider({ drop }: { drop?: number }) {
  return <span data-drop={drop} className="mx-1.5 h-5 w-px shrink-0 bg-border" aria-hidden />
}

/** A menu row with a picture: the icon in a 28px column, the name, a quiet line under it. */
export function MenuRow({ icon, label, hint }: { icon?: ReactNode; label: string; hint?: string }) {
  return (
    <>
      {icon ? <span className="flex w-7 shrink-0 items-center justify-center text-muted-foreground">{icon}</span> : null}
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint ? <span className="type-meta">{hint}</span> : null}
      </span>
    </>
  )
}
