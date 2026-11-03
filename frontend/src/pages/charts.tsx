import { Component, Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react"

import { MenuRow, Tip, ToolButton, ToolDivider } from "@/components/app/toolbar"
import { TargetPickers, useExpiries } from "@/components/app/pickers"
import { AlertIcon, CandlesIcon, ChevronDownIcon, DeltaOiIcon, RetryIcon, StraddleIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { DeltaOiPanel } from "@/chart/delta-oi"
import { ScripChart } from "@/chart/scrip-chart"
import { StraddleChart } from "@/chart/straddle-chart"
import { instrumentName } from "@/lib/instruments"
import { KINDS, PRESET_BY_ID, childPath, resolve, sizeKey, type Kind, type Node } from "@/lib/layouts"
import type { Route } from "@/lib/router"
import { useReference, useUniverse, type Underlying } from "@/lib/use-hub"
import { useWorkspace, workspace, type CellState, type Target } from "@/lib/workspace"
import { cn } from "@/lib/utils"

/** The width of a gutter, px: the room between two containers, and what is grabbed to resize them. */
const GUTTER = 8
/** The least a container may be dragged down to, px. */
const MIN_W = 260
const MIN_H = 180
/** Below this the page is too narrow for side-by-side containers: they stack, one under another. */
const STACK_BELOW = 720
const STACKED_H = 460

const KIND_ICON: Record<Kind, ReactNode> = {
  price: <CandlesIcon />,
  straddle: <StraddleIcon />,
  deltaoi: <DeltaOiIcon />,
}

/** What a container shows, changed from the first button of its toolbar. */
function KindMenu({ kind, onKind }: { kind: Kind; onKind: (kind: Kind) => void }) {
  return (
    <DropdownMenu>
      <Tip label="What this container shows">
        <DropdownMenuTrigger asChild>
          <ToolButton aria-label="Change what this container shows" className="pr-1">
            {KIND_ICON[kind]}
            <ChevronDownIcon size={12} />
          </ToolButton>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuRadioGroup value={kind} onValueChange={(v) => onKind(v as Kind)}>
          {KINDS.map((k) => (
            <DropdownMenuRadioItem key={k.value} value={k.value}>
              <MenuRow icon={KIND_ICON[k.value]} label={k.label} hint={k.hint} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ContainerProps {
  list: readonly Underlying[]
  cell: CellState
  index: number
  active: boolean
  onActivate: () => void
}

/** The start of a container's toolbar: what it shows, its instrument and its expiry. A new instrument starts at its nearest expiry. */
function useLead({ list, cell, index }: ContainerProps) {
  const underlying = list.find((u) => u.id === cell.target.id)
  const { expiries, expiry } = useExpiries(underlying, cell.target.expiry)
  const set = (target: Target) => workspace.patchCell(index, { target })
  const lead = (
    <>
      <KindMenu kind={cell.kind} onKind={(kind) => workspace.patchCell(index, { kind })} />
      <ToolDivider />
      <TargetPickers list={list} id={cell.target.id} expiries={expiries} expiry={expiry} onId={(id) => set({ id })} onExpiry={(e) => set({ id: cell.target.id, expiry: e })} />
    </>
  )
  return { underlying, expiry, lead }
}

function PriceContainer(props: ContainerProps) {
  const { underlying, expiry, lead } = useLead(props)
  const reference = useReference(underlying)
  const future = reference?.includes(":FUT") ?? false
  const name = instrumentName(props.cell.target.id, underlying?.name) + (future ? " futures" : "")
  return (
    <ScripChart
      key={reference ?? props.cell.target.id}
      id={reference ?? props.cell.target.id}
      refId={reference}
      underlying={props.cell.target.id}
      expiry={expiry}
      lot={underlying?.lot ?? 0}
      name={name}
      active={props.active}
      onActivate={props.onActivate}
      pickers={lead}
      stored={props.cell.prefs}
      onStore={(prefs) => workspace.patchCell(props.index, { prefs })}
    />
  )
}

function StraddleContainer(props: ContainerProps) {
  const { underlying, expiry, lead } = useLead(props)
  return <StraddleChart key={`${props.cell.target.id}|${expiry}`} underlying={props.cell.target.id} name={instrumentName(props.cell.target.id, underlying?.name)} expiry={expiry} active={props.active} onActivate={props.onActivate} pickers={lead} />
}

function DeltaOiContainer(props: ContainerProps) {
  const { underlying, expiry, lead } = useLead(props)
  const reference = useReference(underlying)
  return <DeltaOiPanel key={`${props.cell.target.id}|${expiry}`} toolbar={lead} active={props.active} onActivate={props.onActivate} underlying={props.cell.target.id} lot={underlying?.lot ?? 0} expiry={expiry} refId={reference} />
}

function Container(props: ContainerProps) {
  return props.cell.kind === "price" ? <PriceContainer {...props} /> : props.cell.kind === "straddle" ? <StraddleContainer {...props} /> : <DeltaOiContainer {...props} />
}

/** One container that fails to draw leaves the others up: it shows what went wrong and a way to try again. */
class Guard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <Empty className="min-w-0 flex-1 rounded-lg border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertIcon />
          </EmptyMedia>
          <EmptyTitle>This container could not be drawn</EmptyTitle>
          <EmptyDescription>{this.state.error.message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
            <RetryIcon data-icon="inline-start" />
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0)

/**
 * The strip between two containers. Drag it to give one more room and the other less; the arrow keys
 * do the same a step at a time, and a double click puts the layout's own proportions back.
 */
function Gutter({ row, label, onBegin, onDrag, onEnd, onNudge, onReset }: { row: boolean; label: string; onBegin: (e: PointerEvent<HTMLDivElement>) => void; onDrag: (e: PointerEvent<HTMLDivElement>) => void; onEnd: (e: PointerEvent<HTMLDivElement>) => void; onNudge: (step: number) => void; onReset: () => void }) {
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const back = row ? "ArrowLeft" : "ArrowUp"
    const forward = row ? "ArrowRight" : "ArrowDown"
    if (e.key === back) onNudge(-1)
    else if (e.key === forward) onNudge(1)
    else if (e.key === "Home" || e.key === "Enter") onReset()
    else return
    e.preventDefault()
  }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-label={label}
      onPointerDown={onBegin}
      onPointerMove={onDrag}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onKeyDown={keys}
      onDoubleClick={onReset}
      className={cn("group relative z-10 flex shrink-0 touch-none items-center justify-center outline-none", row ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize")}
    >
      <span aria-hidden className={cn("rounded-full bg-transparent transition-colors group-hover:bg-primary/70 group-focus-visible:bg-primary group-active:bg-primary", row ? "h-full w-0.5" : "h-0.5 w-full")} />
    </div>
  )
}

/** `path` is the region's address in the tree; `key` is where its own weights are kept (see `sizeKey`). */
function Region({ node, path, sizes, render }: { node: Node; path: string; sizes: string; render: (leaf: number) => ReactNode }) {
  return "leaf" in node ? <>{render(node.leaf)}</> : <SplitView node={node} path={path} sizes={sizes} render={render} />
}

/** A row or column of regions, each sized by its weight, with a gutter between each pair. */
function SplitView({ node, path, sizes, render }: { node: Extract<Node, { dir: unknown }>; path: string; sizes: string; render: (leaf: number) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ index: number; start: number[]; from: number; size: number; next: number[] | null } | null>(null)
  const row = node.dir === "row"
  const total = sum(node.weights)
  const room = () => {
    const r = box.current?.getBoundingClientRect()
    return Math.max(1, (row ? (r?.width ?? 0) : (r?.height ?? 0)) - (node.kids.length - 1) * GUTTER)
  }
  /** Weights after moving the edge between `index` and the next by `delta` weight, neither side below its least. */
  const shift = (start: number[], index: number, delta: number, size: number) => {
    const pair = start[index]! + start[index + 1]!
    const least = Math.min(pair / 2, ((row ? MIN_W : MIN_H) / size) * total)
    const a = clamp(start[index]! + delta, least, pair - least)
    const next = [...start]
    next[index] = a
    next[index + 1] = pair - a
    return next
  }

  return (
    <div ref={box} data-split={sizes} className={cn("flex min-h-0 min-w-0 flex-1", row ? "flex-row" : "flex-col")}>
      {node.kids.map((kid, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <Gutter
              row={row}
              label={row ? "Resize the containers on either side" : "Resize the containers above and below"}
              onBegin={(e) => {
                if (e.button !== 0) return
                e.currentTarget.setPointerCapture(e.pointerId)
                drag.current = { index: i - 1, start: node.weights, from: row ? e.clientX : e.clientY, size: room(), next: null }
              }}
              onDrag={(e) => {
                const d = drag.current
                if (!d) return
                const delta = (((row ? e.clientX : e.clientY) - d.from) / d.size) * total
                // While the gutter moves only the two panes' flex changes, straight on the page: the store (and
                // every chart under it re-rendering, and localStorage) hears once, when the gutter is let go.
                d.next = shift(d.start, d.index, delta, d.size)
                // A grid's rows share these weights (sizeKey): each split that keeps them here moves with this one.
                for (const split of document.querySelectorAll<HTMLElement>(`[data-split="${sizes}"]`))
                  for (const k of [d.index, d.index + 1]) split.querySelector<HTMLElement>(`:scope > [data-pane="${k}"]`)?.style.setProperty("flex", `${d.next[k]} 1 0%`)
              }}
              onEnd={(e) => {
                const next = drag.current?.next
                drag.current = null
                if (next) workspace.setSizes(sizes, next)
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
              }}
              onNudge={(step) => workspace.setSizes(sizes, shift(node.weights, i - 1, step * total * 0.03, room()))}
              onReset={() => workspace.setSizes(sizes, null)}
            />
          ) : null}
          <div data-pane={i} className="flex min-h-0 min-w-0" style={{ flex: `${node.weights[i]} 1 0%` }}>
            <Region node={kid} path={childPath(path, i)} sizes={sizeKey(node, path, i)} render={render} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** The width of an element, kept current. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const watch = new ResizeObserver(() => setWidth(el.clientWidth))
    watch.observe(el)
    setWidth(el.clientWidth)
    return () => watch.disconnect()
  }, [ref])
  return width
}

/**
 * Charts. The screen is a layout, as on TradingView: one to six containers, arranged by the layout
 * button in the nav bar, their gutters dragged to taste. Each container shows a price chart, a
 * straddle or the Delta × OI board, with its own instrument and expiry, and the arrangement can be
 * saved under a name. One container is the active one, with the accent edge. On a narrow screen the
 * containers stack.
 */
export function ChartsPage({ route }: { route: Extract<Route, { name: "charts" }> }) {
  const { list, loading } = useUniverse()
  const ws = useWorkspace()
  const [active, setActive] = useState(0)
  const page = useRef<HTMLDivElement>(null)
  const width = useWidth(page)

  // A link that names an instrument (a click on an index card or the strip) points every container at it.
  useEffect(() => {
    if (route.underlying) workspace.pointAll({ id: route.underlying, ...(route.expiry ? { expiry: route.expiry } : {}) })
  }, [route.underlying, route.expiry])

  const preset = PRESET_BY_ID.get(ws.preset)!
  const tree = useMemo(() => resolve(preset.tree, ws.sizes), [preset, ws.sizes])
  const solo = ws.cells.length === 1
  const render = (i: number): ReactNode => {
    const cell = ws.cells[i]
    return cell ? (
      <Guard key={i}>
        <Container list={list} cell={cell} index={i} active={!solo && active === i} onActivate={() => setActive(i)} />
      </Guard>
    ) : null
  }
  const stacked = width > 0 && width < STACK_BELOW

  return (
    <div ref={page} className="flex h-full min-h-0 flex-col overflow-auto bg-background p-2">
      {loading ? (
        <div className="flex flex-1 flex-col gap-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="min-h-[360px] w-full flex-1" />
        </div>
      ) : stacked ? (
        <div className="flex flex-col gap-2">
          {ws.cells.map((_, i) => (
            <div key={i} className="flex shrink-0" style={{ height: STACKED_H }}>
              {render(i)}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <Region node={tree} path="" sizes="" render={render} />
        </div>
      )}
    </div>
  )
}
