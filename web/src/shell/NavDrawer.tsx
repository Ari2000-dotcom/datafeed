import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DockviewApi } from "dockview";

import { CANVAS_TONES, type CanvasId } from "../core/canvas";
import { BUILD_ID } from "../core/version";
import { markCurrentWorkspace, useWorkspaces, type SavedWorkspace } from "../core/workspaces";
import type { Hub, HubStatus } from "../hub/client";
import { ArrangementGlyph, ChainRailIcon, CloseThinIcon, DeltaOiRailIcon, FullscreenOnIcon, ListRailIcon, StraddleRailIcon } from "../ui/icons";
import { Logo } from "../ui/Logo";
import { ARRANGEMENTS, arrangementOf, type ArrangementId } from "./arrangements";
import type { BottomId } from "./Footer";
import { useActivePanel } from "./headerSlot";
import type { SideId } from "./SideBar";
import { applyArrangement, isChartKind, replaceChart, type ChartKind } from "./Workspace";

/**
 * The menu, TradingView's way: a drawer that slides in from the left over the desk when the
 * toolbar's menu button is pressed, and takes no room while shut (the charts never move for it).
 * Controls first, one line each: what the active chart is and the chart layout as segmented rows,
 * the panels and the saved layouts as compact rows with their marks, the canvas tone and
 * fullscreen; the feed's state and the build at its foot. Everything fits a laptop's height
 * without a scroll. Esc, a click outside or its close button shuts it, and the keys go back to the
 * menu button.
 */

const STATUS_TEXT: Record<HubStatus, string> = {
  connecting: "Connecting",
  open: "Live",
  reconnecting: "Reconnecting",
  closed: "Disconnected",
};
const STATUS_TONE: Record<HubStatus, string> = {
  connecting: "mh-busy",
  open: "mh-ok",
  reconnecting: "mh-busy",
  closed: "mh-error",
};

const PANELS: readonly ({ name: string; title: string; Icon: () => JSX.Element } & ({ side: SideId } | { bottom: BottomId }))[] = [
  { side: "chain", name: "Option chain", title: "Strikes around the money, in the side panel", Icon: ChainRailIcon },
  { side: "deltaoi", name: "Delta × OI", title: "Call and put exposure, in the side panel", Icon: DeltaOiRailIcon },
  { bottom: "table", name: "All straddles", title: "A row per straddle chart, in the bottom panel", Icon: ListRailIcon },
  { bottom: "details", name: "ATM straddle", title: "Legs, VWAP and IV, in the bottom panel", Icon: StraddleRailIcon },
];

const KINDS: readonly { kind: ChartKind; name: string; title: string }[] = [
  { kind: "straddle", name: "Straddle", title: "The ATM straddle with its VWAP, spot, synthetic future and IV" },
  { kind: "scrip", name: "Scrip", title: "Candles with the OI profile and indicators" },
  { kind: "deltaoi", name: "Δ × OI", title: "Call and put exposure per strike, in a cell of its own" },
];

export function NavDrawer({
  open,
  onClose,
  trigger,
  hub,
  api,
  arrangement,
  side,
  bottom,
  onSide,
  onBottom,
  canvas,
  onCanvas,
  fullscreen,
  onFullscreen,
  onLoad,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  /** The menu button, where the keys go back to when the drawer shuts. */
  trigger: React.RefObject<HTMLButtonElement>;
  hub: Hub | null;
  api: DockviewApi | null;
  arrangement: ArrangementId;
  side: SideId | null;
  bottom: BottomId | null;
  onSide: (id: SideId) => void;
  onBottom: (id: BottomId) => void;
  canvas: CanvasId;
  onCanvas: (id: CanvasId) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  onLoad: (workspace: SavedWorkspace) => void;
}>) {
  const panel = useRef<HTMLElement>(null);
  const active = useActivePanel();
  const kind = active ? api?.getPanel(active)?.api.component : undefined;
  const { list: saved, current } = useWorkspaces();
  const [status, setStatus] = useState<HubStatus>(hub?.state ?? "connecting");
  useEffect(() => (hub ? hub.onStatus(setStatus) : undefined), [hub]);

  // Open: the keys move into the drawer and Esc shuts it. Shut: they go back to the menu button.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      panel.current?.querySelector<HTMLElement>(".mh-nav-body button")?.focus({ preventScroll: true });
      const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
      window.addEventListener("keydown", esc);
      wasOpen.current = true;
      return () => window.removeEventListener("keydown", esc);
    }
    if (wasOpen.current) trigger.current?.focus({ preventScroll: true });
    wasOpen.current = false;
  }, [open, onClose, trigger]);

  /** Does what a control says and shuts the drawer, as a menu does. */
  const then = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <>
      <div className="mh-nav-scrim" data-open={open || undefined} onPointerDown={onClose} aria-hidden />
      <aside ref={panel} className="mh-nav" data-open={open || undefined} aria-label="Menu" aria-hidden={!open}>
        <div className="mh-nav-head">
          <Logo />
          <span className="mh-wordmark">
            Alpha<span className="mh-wordmark-hedge">Hedge</span>
          </span>
          <span className="mh-spacer" />
          <button type="button" className="mh-panel-close" aria-label="Close the menu" title="Close (Esc)" onClick={onClose}>
            <CloseThinIcon />
          </button>
        </div>

        <div className="mh-nav-body">
          {api && active && isChartKind(kind) ? (
            <Group title="Chart">
              <div className="mh-seg" role="radiogroup" aria-label="Active chart">
                {KINDS.map((k) => (
                  <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} className="mh-seg-btn" title={k.title} onClick={then(() => replaceChart(api, active, k.kind))}>
                    {k.name}
                  </button>
                ))}
              </div>
            </Group>
          ) : null}

          {/* The desk's own groups, only while the Charts page (the desk) is open. */}
          {api ? (
            <>
              <Group title="Layout">
                <div className="mh-nav-layouts" role="radiogroup" aria-label="Chart layout">
                  {ARRANGEMENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={arrangement === a.id}
                      className="mh-nav-layout"
                      aria-label={a.name}
                      title={a.name}
                      onClick={then(() => api && applyArrangement(api, a.id))}
                    >
                      <ArrangementGlyph rects={a.rects} />
                    </button>
                  ))}
                </div>
              </Group>

              <Group title="Panels">
                {PANELS.map((p) => {
                  const on = "side" in p ? side === p.side : bottom === p.bottom;
                  return (
                    <Row key={p.name} title={p.title} on={on} onClick={then(() => ("side" in p ? onSide(p.side) : onBottom(p.bottom)))}>
                      <p.Icon />
                      <span className="mh-nav-label">{p.name}</span>
                    </Row>
                  );
                })}
              </Group>

              <Group title="Saved layouts">
                {saved.length > 0 ? (
                  saved.slice(0, 5).map((w) => {
                    const layout = w.layout as { v?: number; arrangement?: string } | null;
                    return (
                      <Row
                        key={w.id}
                        title={`Open “${w.name}”`}
                        on={w.id === current}
                        onClick={then(() => {
                          markCurrentWorkspace(w.id);
                          onLoad(w);
                        })}
                      >
                        <ArrangementGlyph rects={arrangementOf(layout?.v === 2 ? layout.arrangement : undefined).rects} />
                        <span className="mh-nav-label">{w.name}</span>
                        <span className="mh-nav-count">{w.panels}</span>
                      </Row>
                    );
                  })
                ) : (
                  <p className="mh-nav-empty">None saved yet</p>
                )}
              </Group>

            </>
          ) : null}

          <Group title="Display">
            <div className="mh-seg" role="radiogroup" aria-label="Canvas tone">
              {/* A tone is tried in place: the drawer stays open over the desk it repaints. */}
              {CANVAS_TONES.map((tone) => (
                <button key={tone.id} type="button" role="radio" aria-checked={canvas === tone.id} className="mh-seg-btn" title={tone.note} onClick={() => onCanvas(tone.id)}>
                  <span className="mh-seg-swatch" data-canvas={tone.id} aria-hidden />
                  {tone.name}
                </button>
              ))}
            </div>
            <Row title="Hide the browser's own bars" on={fullscreen} onClick={then(onFullscreen)}>
              <FullscreenOnIcon />
              <span className="mh-nav-label">Fullscreen</span>
            </Row>
          </Group>
        </div>

        <div className="mh-nav-foot">
          <span className={`mh-dot ${STATUS_TONE[status]}`} aria-hidden />
          {STATUS_TEXT[status]}
          <span className="mh-spacer" />
          <span className="mh-nav-build">{BUILD_ID === "dev" ? "Development build" : `Build ${BUILD_ID}`}</span>
        </div>
      </aside>
    </>
  );
}

function Group({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="mh-nav-group" aria-label={title}>
      <h2 className="mh-nav-title">{title}</h2>
      {children}
    </section>
  );
}

/** One line: its mark, its name, and the selected wash where it is the one in use. */
function Row({ title, on, onClick, children }: Readonly<{ title: string; on: boolean; onClick: () => void; children: ReactNode }>) {
  return (
    <button type="button" className="mh-nav-row" aria-pressed={on} title={title} onClick={onClick}>
      {children}
    </button>
  );
}
