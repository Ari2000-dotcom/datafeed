import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"

import {
  AlertIcon,
  FullscreenOffIcon,
  FullscreenOnIcon,
} from "@/components/icons"
import { FolderTab } from "@/components/app/folder"
import { Tip, ToolButton } from "@/components/app/toolbar"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useFitRow } from "@/lib/fit-row"
import { cn } from "@/lib/utils"

/** Full screen for whatever element `ref` is put on: the state, and the toggle. */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === ref.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void ref.current?.requestFullscreen?.()
  }
  return { ref, full, toggle }
}

export function FullscreenButton({
  full,
  onToggle,
}: {
  full: boolean
  onToggle: () => void
}) {
  return (
    <Tip label={full ? "Exit full screen" : "Full screen"}>
      <ToolButton
        aria-label={full ? "Exit full screen" : "Full screen"}
        onClick={onToggle}
      >
        {full ? <FullscreenOffIcon /> : <FullscreenOnIcon />}
      </ToolButton>
    </Tip>
  )
}

/**
 * The container every chart sits in. Its canvas is the chart colour, a deeper ink-blue than the
 * panels around it; its toolbar sits on the panel colour above. When several charts share a page
 * one of them is the active container: it takes the accent for its edge and the keyboard and the
 * toolbar's commands are its own. A click or a focus anywhere inside makes a container active.
 *
 * The legend floats over the canvas's top-left and takes no pointer events, so it never blocks a
 * pan. `header` sits between the toolbar and the canvas (a chart's key figures). `state` covers the
 * canvas while there is nothing to draw. `children` are overlays that need the canvas's own
 * coordinates, such as a hover card.
 */
export function ChartFrame({
  label,
  toolbar,
  tools,
  header,
  footer,
  legend,
  host,
  state,
  active = false,
  onActivate,
  children,
  className,
}: {
  label: string
  toolbar: ReactNode
  tools?: ReactNode
  header?: ReactNode
  footer?: ReactNode
  legend?: ReactNode
  host: RefObject<HTMLDivElement | null>
  state?:
    | { kind: "loading" }
    | { kind: "message"; title: string; description: string }
  active?: boolean
  onActivate?: () => void
  children?: ReactNode
  className?: string
}) {
  const { ref: frame, full, toggle } = useFullscreen<HTMLElement>()
  const fitBar = useFitRow()

  return (
    // QuantDesk's container: a folder tab with the container's name over the plate, both framed in
    // indigo while active. Full screen takes the plate alone.
    <div
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      onPointerDownCapture={onActivate}
    >
    <FolderTab title={label} active={active} />
    <section
      ref={frame}
      aria-label={label}
      data-active={active || undefined}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      className="@container/chart flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden panel rounded-tl-none bg-chart"
    >
      {/* One row, always: pieces marked data-drop give way as the container narrows (useFitRow), and what is still too wide is clipped, never wrapped. */}
      <div
        ref={fitBar}
        className="chart-bar panel-head flex h-[38px] shrink-0 items-center gap-x-3 overflow-hidden bg-chart-toolbar px-1.5"
      >
        {/* At the narrowest the lead clips, not the tools on the right: those (more, full screen) are never cut off. */}
        <div className="flex min-w-0 items-center gap-x-0.5 overflow-hidden">
          {toolbar}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {tools}
          <FullscreenButton full={full} onToggle={toggle} />
        </div>
      </div>
      {header}
      <div className="relative min-h-0 flex-1 bg-chart">
        <div ref={host} className="absolute inset-0" />
        {legend ? (
          <div className="pointer-events-none absolute top-2.5 left-3 flex max-w-[calc(100%-6rem)] flex-col gap-0.5 text-xs">
            {legend}
          </div>
        ) : null}
        {children}
        {state ? (
          <div className="absolute inset-0 flex bg-chart">
            {state.kind === "loading" ? (
              <div
                className="flex w-full flex-col gap-3 p-6"
                aria-busy="true"
                aria-label="Loading chart"
              >
                <Skeleton className="h-4 w-48" />
                <Skeleton className="w-full flex-1" />
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <AlertIcon />
                  </EmptyMedia>
                  <EmptyTitle>{state.title}</EmptyTitle>
                  <EmptyDescription>{state.description}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        ) : null}
      </div>
      {footer ? (
        <div className="flex h-7 shrink-0 items-center gap-0.5 border-t bg-chart-toolbar px-1.5 text-xs">
          {footer}
        </div>
      ) : null}
    </section>
    </div>
  )
}
