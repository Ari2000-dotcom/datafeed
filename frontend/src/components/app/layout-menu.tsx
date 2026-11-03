import { useState, type FormEvent } from "react"

import { LayoutGlyph } from "@/components/app/layout-glyph"
import { Tip, ToolButton } from "@/components/app/toolbar"
import { ChevronDownIcon, PencilIcon, TrashIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { PRESET_BY_ID, PRESET_GROUPS, resolve, type Preset } from "@/lib/layouts"
import { isModified, useSavedLayouts, useWorkspace, workspace, type SavedLayout } from "@/lib/workspace"
import { cn } from "@/lib/utils"

const ROW_ICON =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"

/** How many containers a layout has. */
const countOf = (node: Preset["tree"]): number => ("leaf" in node ? 1 : node.kids.reduce((n, k) => n + countOf(k), 0))

/**
 * One layout in the picker: its picture, outlined when it is the one in use. No tooltip: one floating
 * over the grid hid the row above it, so the name shows in the picker's caption line instead.
 */
function PresetTile({ preset, on, onPick, onHover }: { preset: Preset; on: boolean; onPick: () => void; onHover: (name: string | null) => void }) {
  return (
    <button
      type="button"
      aria-label={preset.name}
      aria-pressed={on}
      onClick={onPick}
      onPointerEnter={() => onHover(preset.name)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(preset.name)}
      onBlur={() => onHover(null)}
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:shadow-[inset_0_0_0_1px_var(--primary)]"
    >
      <LayoutGlyph tree={preset.tree} />
    </button>
  )
}

/** A saved layout: click to bring it back; rename and delete show on hover. Deleting asks once, in the row. */
function SavedRow({ layout, current, modified, onLoad }: { layout: SavedLayout; current: boolean; modified: boolean; onLoad: () => void }) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view")
  const preset = PRESET_BY_ID.get(layout.workspace.preset)
  if (!preset) return null

  if (mode === "delete") {
    return (
      <li className="flex h-10 items-center gap-2 rounded-md bg-accent px-2">
        <span className="min-w-0 flex-1 truncate text-sm">Delete “{layout.name}”?</span>
        <Button size="sm" variant="destructive" onClick={() => workspace.remove(layout.id)}>
          Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
          Keep
        </Button>
      </li>
    )
  }

  if (mode === "rename") {
    const done = (name: string) => {
      workspace.rename(layout.id, name)
      setMode("view")
    }
    return (
      <li className="flex h-10 items-center gap-2 rounded-md bg-accent px-2">
        <LayoutGlyph tree={resolve(preset.tree, layout.workspace.sizes)} className="text-muted-foreground" />
        <Input
          autoFocus
          aria-label="Layout name"
          defaultValue={layout.name}
          maxLength={40}
          className="h-7"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => done(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") done(e.currentTarget.value)
            if (e.key === "Escape") {
              e.stopPropagation()
              setMode("view")
            }
          }}
        />
      </li>
    )
  }

  return (
    <li className={cn("group flex h-9 items-center gap-1 rounded-md pr-1 transition-colors hover:bg-accent focus-within:bg-accent", current && "bg-accent")}>
      <button type="button" onClick={onLoad} className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md pl-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <LayoutGlyph tree={resolve(preset.tree, layout.workspace.sizes)} className={current ? "text-primary" : "text-muted-foreground"} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium">{layout.name}</span>
          <span className="truncate text-xs text-subtle">{current && modified ? "Changed since saved" : preset.name}</span>
        </span>
      </button>
      <Tip label="Rename">
        <button type="button" aria-label={`Rename ${layout.name}`} onClick={() => setMode("rename")} className={cn(ROW_ICON, "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}>
          <PencilIcon />
        </button>
      </Tip>
      <Tip label="Delete">
        <button type="button" aria-label={`Delete ${layout.name}`} onClick={() => setMode("delete")} className={cn(ROW_ICON, "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}>
          <TrashIcon />
        </button>
      </Tip>
    </li>
  )
}

/**
 * The layout button for the nav bar on the Charts screen, TradingView's way: the arrangement in use as
 * a picture, and under it a popover to pick another (one to six containers, each a different split),
 * to bring back a saved one, and to save the one on screen under a name.
 */
export function LayoutMenu({ className }: { className?: string }) {
  const ws = useWorkspace()
  const saved = useSavedLayouts()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [hovered, setHovered] = useState<string | null>(null)
  const preset = PRESET_BY_ID.get(ws.preset)!
  const from = saved.find((s) => s.id === ws.from)
  const modified = isModified(ws, from)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    workspace.save(name)
    setName("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="Chart layout">
        <PopoverTrigger asChild>
          <ToolButton aria-label="Chart layout" className={cn("gap-0.5 pr-1.5 pl-0.5", className)}>
            <LayoutGlyph tree={resolve(preset.tree, ws.sizes)} />
            {from ? (
              <span className="hidden max-w-36 items-center gap-1 truncate text-xs lg:inline-flex">
                <span className="truncate">{from.name}</span>
                {modified ? <span className="size-1.5 shrink-0 rounded-full bg-primary" role="img" aria-label="Changed since saved" /> : null}
              </span>
            ) : null}
            <ChevronDownIcon size={12} />
          </ToolButton>
        </PopoverTrigger>
      </Tip>
      {/* Closing leaves focus where it was rather than on the button, whose tooltip would then sit over the strip. */}
      <PopoverContent align="start" className="w-auto min-w-72 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
        {/* TradingView's picker: a row per number of charts, the count at the start of it. */}
        <div className="flex flex-col gap-0.5 p-2">
          {PRESET_GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title} className="flex items-center gap-1">
              <span className="num w-5 shrink-0 text-center text-xs text-subtle" aria-hidden>
                {countOf(group.presets[0]!.tree)}
              </span>
              <div className="flex gap-0.5">
                {group.presets.map((p) => (
                  <PresetTile
                    key={p.id}
                    preset={p}
                    on={p.id === ws.preset}
                    onHover={setHovered}
                    onPick={() => {
                      workspace.setPreset(p.id)
                      setOpen(false)
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
          <p className="truncate px-1 pt-1 text-xs text-muted-foreground" aria-live="polite">
            {hovered ?? preset.name}
          </p>
        </div>

        <section aria-label="Saved layouts" className="border-t p-1">
          <h3 className="px-2 pt-1 pb-0.5 text-xs font-medium text-subtle">Saved layouts</h3>
          {saved.length === 0 ? (
            <p className="max-w-64 px-2 pb-1.5 text-xs text-muted-foreground">None yet. Name the layout on screen below to keep it.</p>
          ) : (
            <ul className="flex max-h-52 flex-col overflow-y-auto bg-popover">
              {saved.map((s) => (
                <SavedRow
                  key={s.id}
                  layout={s}
                  current={s.id === ws.from}
                  modified={modified}
                  onLoad={() => {
                    workspace.load(s.id)
                    setOpen(false)
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-1.5 border-t p-2">
          {from && modified ? (
            <Button size="sm" variant="secondary" onClick={() => workspace.update(from.id)} className="justify-center">
              Update “{from.name}”
            </Button>
          ) : null}
          <form onSubmit={submit} className="flex items-center gap-2">
            <Input aria-label="Layout name" className="h-7 text-xs" placeholder={from ? "Save as a new layout" : "Name this layout"} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Save
            </Button>
          </form>
        </div>
      </PopoverContent>
    </Popover>
  )
}
