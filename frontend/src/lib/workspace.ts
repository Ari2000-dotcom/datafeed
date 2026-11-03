import { useSyncExternalStore } from "react"

import { KINDS, PRESET_BY_ID, type Kind } from "@/lib/layouts"

/** What a chart container shows: an underlying and one of its expiries (the nearest when none is named). */
export interface Target {
  id: string
  expiry?: string
}

/** One container: what it draws, of which instrument, and the chart's own settings (interval, indicators…). */
export interface CellState {
  kind: Kind
  target: Target
  prefs?: Record<string, unknown>
}

/**
 * The Charts page as the viewer arranged it: which layout, how far each gutter was dragged, and what each
 * container holds. `from` names the saved layout it was last loaded from or saved as.
 */
export interface Workspace {
  preset: string
  sizes: Record<string, number[]>
  cells: CellState[]
  from?: string
}

export interface SavedLayout {
  id: string
  name: string
  at: number
  workspace: Omit<Workspace, "from">
}

const WORKSPACE_KEY = "ah:charts:workspace"
const SAVED_KEY = "ah:charts:layouts"
const NIFTY: Target = { id: "nse:nifty" }
/** What a container added by a bigger layout shows, in turn. */
const FILL: readonly Kind[] = ["price", "straddle", "deltaoi"]

/** The first visit: the price chart and the straddle side by side, on what the old screen remembered. */
function fresh(): Workspace {
  let price = NIFTY
  let straddle = NIFTY
  try {
    const old = JSON.parse(localStorage.getItem("ah:charts:targets") ?? "null") as { price?: Target; straddle?: Target } | null
    if (typeof old?.price?.id === "string") price = old.price
    if (typeof old?.straddle?.id === "string") straddle = old.straddle
  } catch {
    // Nothing remembered.
  }
  return { preset: "2c", sizes: {}, cells: [{ kind: "price", target: price }, { kind: "straddle", target: straddle }] }
}

function cleanCell(raw: unknown, i: number, lead: Target): CellState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CellState>
  const kind = KINDS.some((k) => k.value === r.kind) ? (r.kind as Kind) : FILL[i % FILL.length]!
  const t = r.target
  const target: Target = t && typeof t.id === "string" ? { id: t.id, ...(typeof t.expiry === "string" ? { expiry: t.expiry } : {}) } : lead
  return { kind, target, ...(r.prefs && typeof r.prefs === "object" ? { prefs: r.prefs } : {}) }
}

/** A stored workspace made safe to use: unknown layouts, missing cells and bad weights are put right. */
function clean(raw: unknown): Omit<Workspace, "from"> | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Partial<Workspace>
  const preset = PRESET_BY_ID.get(r.preset ?? "")
  if (!preset) return null
  const given = Array.isArray(r.cells) ? r.cells : []
  const lead = cleanCell(given[0], 0, NIFTY).target
  const cells = Array.from({ length: preset.count }, (_, i) => cleanCell(given[i], i, lead))
  const sizes: Record<string, number[]> = {}
  if (r.sizes && typeof r.sizes === "object") {
    for (const [path, w] of Object.entries(r.sizes)) {
      if (Array.isArray(w) && w.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) sizes[path] = w
    }
  }
  return { preset: preset.id, sizes, cells }
}

function readWorkspace(): Workspace {
  try {
    const raw = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? "null") as (Partial<Workspace> & { from?: unknown }) | null
    const ws = clean(raw)
    if (ws) return { ...ws, ...(typeof raw?.from === "string" ? { from: raw.from } : {}) }
  } catch {
    // Fall through to the first-visit layout.
  }
  return fresh()
}

function readSaved(): SavedLayout[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap((s: Partial<SavedLayout>) => {
      const ws = clean(s?.workspace)
      return ws && typeof s.id === "string" && typeof s.name === "string" ? [{ id: s.id, name: s.name, at: typeof s.at === "number" ? s.at : 0, workspace: ws }] : []
    })
  } catch {
    return []
  }
}

let current: Workspace = readWorkspace()
let saved: SavedLayout[] = readSaved()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

function persist(): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(current))
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved))
  } catch {
    // A per-viewer convenience only.
  }
}

/** A drag changes the weights many times a second: the write waits for it to settle. */
function changed(): void {
  for (const fn of listeners) fn()
  clearTimeout(timer)
  timer = setTimeout(persist, 250)
}

if (typeof window !== "undefined") window.addEventListener("pagehide", persist)

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useWorkspace = (): Workspace => useSyncExternalStore(subscribe, () => current)
export const useSavedLayouts = (): SavedLayout[] => useSyncExternalStore(subscribe, () => saved)

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const snapshot = (ws: Workspace): Omit<Workspace, "from"> => ({ preset: ws.preset, sizes: copy(ws.sizes), cells: copy(ws.cells) })

/** Has the arrangement changed since it was saved? Compared as stored, so a drag of a gutter counts. */
export function isModified(ws: Workspace, layout: SavedLayout | undefined): boolean {
  return layout ? JSON.stringify(snapshot(ws)) !== JSON.stringify(layout.workspace) : false
}

export const workspace = {
  /** Choose a layout: containers carry over in order, a new one starts with the next kind on the first one's instrument. */
  setPreset(id: string): void {
    const p = PRESET_BY_ID.get(id)
    if (!p || p.id === current.preset) return
    const lead = current.cells[0]?.target ?? NIFTY
    const cells = Array.from({ length: p.count }, (_, i) => current.cells[i] ?? { kind: FILL[i % FILL.length]!, target: lead })
    current = { ...current, preset: p.id, sizes: {}, cells }
    changed()
  },

  patchCell(index: number, patch: Partial<CellState>): void {
    if (!current.cells[index]) return
    current = { ...current, cells: current.cells.map((c, i) => (i === index ? { ...c, ...patch } : c)) }
    changed()
  },

  /** A gutter's new weights, or null to go back to the layout's own. */
  setSizes(path: string, weights: number[] | null): void {
    const sizes = { ...current.sizes }
    if (weights) sizes[path] = weights
    else delete sizes[path]
    current = { ...current, sizes }
    changed()
  },

  /** A link that names an instrument (a click on an index card or the strip) points every container at it. */
  pointAll(target: Target): void {
    current = { ...current, cells: current.cells.map((c) => ({ ...c, target })) }
    changed()
  },

  /** Save the arrangement under a name. */
  save(name: string): string {
    const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    const label = name.trim().slice(0, 40) || `Layout ${saved.length + 1}`
    saved = [...saved, { id, name: label, at: Date.now(), workspace: snapshot(current) }]
    current = { ...current, from: id }
    changed()
    return id
  },

  /** Overwrite a saved layout with the arrangement on screen. */
  update(id: string): void {
    saved = saved.map((s) => (s.id === id ? { ...s, at: Date.now(), workspace: snapshot(current) } : s))
    current = { ...current, from: id }
    changed()
  },

  load(id: string): void {
    const s = saved.find((l) => l.id === id)
    if (!s) return
    current = { ...copy(s.workspace), from: id }
    changed()
  },

  rename(id: string, name: string): void {
    const label = name.trim().slice(0, 40)
    if (!label) return
    saved = saved.map((s) => (s.id === id ? { ...s, name: label } : s))
    changed()
  },

  remove(id: string): void {
    saved = saved.filter((s) => s.id !== id)
    if (current.from === id) current = { ...current, from: undefined }
    changed()
  },
}
