import { useMemo } from "react"

import { ChevronDownIcon } from "@/components/icons"
import { MenuRow, ToolDivider } from "@/components/app/toolbar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EXCHANGE, instrumentName } from "@/lib/instruments"
import { dateLabel, expiryLabel, istDate, nearestExpiry } from "@/lib/format"
import type { Underlying } from "@/lib/use-hub"
import { cn } from "@/lib/utils"

/** The expiries still to come, and the one in force: the one asked for if it is among them, else the nearest. */
export function useExpiries(underlying: Underlying | undefined, requested: string | undefined) {
  const today = istDate(Date.now())
  const expiries = useMemo(() => (underlying?.expiries ?? []).filter((d) => d >= today), [underlying, today])
  const expiry = requested && expiries.includes(requested) ? requested : nearestExpiry(expiries)
  return { expiries, expiry }
}

const TRIGGER =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 whitespace-nowrap outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-accent aria-expanded:text-foreground disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed"

/** The instrument, as a name you can click to change: no box, the way a chart's symbol sits in its header. */
export function UnderlyingPicker({ value, list, onChange, compact }: { value: string; list: readonly Underlying[]; onChange: (id: string) => void; compact?: boolean }) {
  const items = list.length > 0 ? list : [{ id: value, name: instrumentName(value) }]
  const current = items.find((u) => u.id === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={TRIGGER} aria-label="Change instrument">
        <span className={compact ? "text-sm font-medium" : "text-base font-medium"}>{instrumentName(value, current?.name)}</span>
        {compact ? null : <span className="type-meta">{EXCHANGE[value.split(":")[0] ?? ""] ?? ""}</span>}
        <ChevronDownIcon size={compact ? 12 : 16} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-60">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {items.map((u) => (
            <DropdownMenuRadioItem key={u.id} value={u.id}>
              <span className="font-medium">{instrumentName(u.id, u.name)}</span>
              <span className="text-xs text-subtle">{EXCHANGE[u.id.split(":")[0] ?? ""] ?? ""}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ExpiryPicker({ value, expiries, onChange, disabled, className, compact }: { value: string | undefined; expiries: readonly string[]; onChange: (expiry: string) => void; disabled?: boolean; className?: string; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(TRIGGER, "text-sm text-soft", className)} disabled={disabled || expiries.length === 0} aria-label="Change expiry">
        {compact ? null : <span className="type-label">Expiry</span>}
        <span className="num">{value ? (compact ? expiryLabel(value) : dateLabel(value)) : "-"}</span>
        <ChevronDownIcon size={compact ? 12 : 16} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-48">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onChange}>
          {expiries.map((d) => (
            <DropdownMenuRadioItem key={d} value={d}>
              <MenuRow label={dateLabel(d)} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A chart container's own instrument and expiry, at the start of its toolbar. */
export function TargetPickers({ list, id, expiries, expiry, onId, onExpiry }: { list: readonly Underlying[]; id: string; expiries: readonly string[]; expiry: string | undefined; onId: (id: string) => void; onExpiry: (expiry: string) => void }) {
  return (
    <>
      <UnderlyingPicker compact value={id} list={list} onChange={onId} />
      <ExpiryPicker compact value={expiry} expiries={expiries} onChange={onExpiry} />
      <ToolDivider />
    </>
  )
}
