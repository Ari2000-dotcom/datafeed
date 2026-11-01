import { useCallback, useEffect, useRef, useState } from "react";
import type { DockviewApi } from "dockview";

import { applyCanvas, loadCanvas, type CanvasId } from "./core/canvas";
import { usePage } from "./core/route";
import { Hub, hubUrl } from "./hub/client";
import { UpdateToast } from "./shell/UpdateToast";
import { applyArrangement, CHART_KINDS, dockKind, isChartKind, loadDesk, replaceChart, useArrangement, Workspace, type ChartKind } from "./shell/Workspace";
import { ARRANGEMENTS, arrangementOf } from "./shell/arrangements";
import { AppBar } from "./shell/AppBar";
import { ChainPage } from "./shell/ChainPage";
import { setToolbarSlot, useActivePanel } from "./shell/headerSlot";
import { LayoutsMenu } from "./shell/WorkspaceMenu";
import { ToolsBar } from "./shell/ToolsBar";
import { Rail, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, SidePanel, type SideId } from "./shell/SideBar";
import { BOTTOM_DEFAULT, BOTTOM_MIN, BottomPanel, Footer, type BottomId } from "./shell/Footer";
import { NavDrawer } from "./shell/NavDrawer";
import { useFullscreen } from "./core/fullscreen";
import { Dropdown } from "./ui/Dropdown";
import { ArrangementGlyph } from "./ui/icons";
import type { SavedWorkspace } from "./core/workspaces";

/*
 * The site: the app bar across the top (the menu, the mark, the pages, and the indices, the feed,
 * the canvas tone and fullscreen), and under it the page that is open. Charts is the desk,
 * TradingView's way: the chart toolbar (the active chart's controls, the layout and the saved
 * layouts), the tools bar down the left, the chart grid with the bottom panel and the footer under
 * it, and the side panel with its rail on the right, every region a plate on the workspace tone.
 * Option chain is the chain and Delta × OI side by side.
 */

/** Which side and bottom panels are open and how big, on this computer. */
interface ShellState {
  side: SideId | null;
  sideWidth: number;
  bottom: BottomId | null;
  bottomHeight: number;
}
const SHELL_KEY = "mh.shell";
const SHELL_DEFAULT: ShellState = { side: null, sideWidth: SIDE_DEFAULT, bottom: null, bottomHeight: BOTTOM_DEFAULT };

function loadShell(): ShellState {
  try {
    const raw = JSON.parse(localStorage.getItem(SHELL_KEY) ?? "null") as Partial<ShellState> | null;
    if (!raw) return SHELL_DEFAULT;
    return {
      side: raw.side === "chain" || raw.side === "deltaoi" ? raw.side : null,
      sideWidth: typeof raw.sideWidth === "number" ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(raw.sideWidth))) : SIDE_DEFAULT,
      bottom: raw.bottom === "table" || raw.bottom === "details" ? raw.bottom : null,
      bottomHeight: typeof raw.bottomHeight === "number" ? Math.max(BOTTOM_MIN, Math.round(raw.bottomHeight)) : BOTTOM_DEFAULT,
    };
  } catch {
    return SHELL_DEFAULT;
  }
}

export function App() {
  const [canvas, setCanvas] = useState<CanvasId>(loadCanvas);
  useEffect(() => applyCanvas(canvas), [canvas]);
  const page = usePage();

  // The site is open to everyone: one connection per page, no key. The hub
  // client reconnects by itself, so a hub that is down reads "Reconnecting".
  const [hub, setHub] = useState<Hub | null>(null);
  useEffect(() => {
    const h = new Hub(hubUrl());
    setHub(h);
    return () => {
      h.close();
      setHub(null);
    };
  }, []);

  const dock = useRef<DockviewApi | null>(null);
  const [dockApi, setDockApi] = useState<DockviewApi | null>(null);
  // Off the Charts page the desk is not mounted: nothing to act on until it is back.
  useEffect(() => {
    if (page === "charts") return;
    dock.current = null;
    setDockApi(null);
  }, [page]);
  const lay = (fn: (api: DockviewApi) => void) => {
    const api = dock.current;
    if (api) fn(api);
  };
  const loadWorkspace = (workspace: SavedWorkspace) => lay((api) => loadDesk(api, workspace.layout));
  const [fullscreen, toggleFullscreen] = useFullscreen();
  const arrangement = useArrangement();
  // The menu drawer: over the page while open, nothing while shut.
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const menuButton = useRef<HTMLButtonElement>(null);

  const [shell, setShell] = useState<ShellState>(loadShell);
  useEffect(() => {
    try {
      localStorage.setItem(SHELL_KEY, JSON.stringify(shell));
    } catch {
      // A per-viewer convenience only.
    }
  }, [shell]);
  const toggleSide = (side: SideId) => setShell((s) => ({ ...s, side: s.side === side ? null : side }));
  const toggleBottom = (bottom: BottomId) => setShell((s) => ({ ...s, bottom: s.bottom === bottom ? null : bottom }));

  // "Add straddle" on a chart: the option chain to pick from, in the side panel.
  useEffect(() => {
    const open = () => setShell((s) => ({ ...s, side: "chain" }));
    window.addEventListener("mh-add-straddle", open);
    return () => window.removeEventListener("mh-add-straddle", open);
  }, []);

  // The bottom panel never takes more than 60% of the chart column.
  const [center, setCenter] = useState<HTMLElement | null>(null);
  const [centerHeight, setCenterHeight] = useState(0);
  useEffect(() => {
    if (!center) return;
    const ro = new ResizeObserver(() => setCenterHeight(center.clientHeight));
    ro.observe(center);
    return () => ro.disconnect();
  }, [center]);
  const bottomMax = Math.max(BOTTOM_MIN, Math.round(centerHeight * 0.6));

  return (
    <div className="mh-app">
      <AppBar
        page={page}
        hub={hub}
        menuButton={menuButton}
        menuOpen={navOpen}
        onMenu={() => setNavOpen((v) => !v)}
        canvas={canvas}
        onCanvas={setCanvas}
        fullscreen={fullscreen}
        onFullscreen={toggleFullscreen}
      />

      {page === "chain" && hub ? <ChainPage hub={hub} /> : null}

      {page === "charts" ? (
        <div className="mh-desk" data-side={shell.side ? "" : undefined}>
          <header className="mh-toolbar mh-plate">
            <ChartKindPicker api={dockApi} />
            {/* The chart's kind, then the chart's own controls: two jobs, kept apart as TradingView's groups are. */}
            <span className="mh-tv-sep" aria-hidden />
            <div className="mh-toolbar-slot" ref={setToolbarSlot} />
            <span className="mh-tv-sep" aria-hidden />
            <Dropdown
              label="Layout"
              heading="Layout"
              icon={<ArrangementGlyph rects={arrangementOf(arrangement).rects} />}
              align="end"
              value={arrangement}
              onChange={(id) => lay((api) => applyArrangement(api, id))}
              options={ARRANGEMENTS.map((a) => ({ value: a.id, label: a.name, group: `${a.count} ${a.count === 1 ? "chart" : "charts"}`, icon: <ArrangementGlyph rects={a.rects} /> }))}
            />
            <LayoutsMenu getApi={() => dock.current} onLoad={loadWorkspace} />
          </header>

          <ToolsBar />

          <div className="mh-center" ref={setCenter}>
            {hub ? (
              <Workspace
                hub={hub}
                themeKey={canvas}
                onApi={(api) => {
                  dock.current = api;
                  setDockApi(api);
                }}
                // Delta × OI dragged in from the side panel is in the grid now: the panel shuts.
                onDocked={(kind) => setShell((s) => (s.side === kind ? { ...s, side: null } : s))}
              />
            ) : null}
            {hub && shell.bottom ? (
              <BottomPanel
                id={shell.bottom}
                hub={hub}
                height={shell.bottomHeight}
                maxHeight={bottomMax}
                onHeight={(bottomHeight) => setShell((s) => ({ ...s, bottomHeight }))}
              />
            ) : null}
            <Footer open={shell.bottom} onToggle={toggleBottom} onClose={() => setShell((s) => ({ ...s, bottom: null }))} />
          </div>

          {hub && shell.side ? (
            <SidePanel
              id={shell.side}
              hub={hub}
              width={shell.sideWidth}
              onWidth={(sideWidth) => setShell((s) => ({ ...s, sideWidth }))}
              onClose={() => setShell((s) => ({ ...s, side: null }))}
              // The button's way of what the drag does: Delta × OI under the active chart.
              onDock={
                dockApi && shell.side === "deltaoi"
                  ? () => {
                      const api = dockApi;
                      if (dockKind(api, "deltaoi", "bottom", api.activeGroup ?? api.groups[0])) setShell((s) => ({ ...s, side: null }));
                    }
                  : undefined
              }
            />
          ) : null}
          <Rail open={shell.side} onToggle={toggleSide} />
        </div>
      ) : null}

      <NavDrawer
        open={navOpen}
        onClose={closeNav}
        trigger={menuButton}
        hub={hub}
        api={page === "charts" ? dockApi : null}
        arrangement={arrangement}
        side={shell.side}
        bottom={shell.bottom}
        onSide={toggleSide}
        onBottom={toggleBottom}
        canvas={canvas}
        onCanvas={setCanvas}
        fullscreen={fullscreen}
        onFullscreen={toggleFullscreen}
        onLoad={loadWorkspace}
      />

      <UpdateToast />
    </div>
  );
}

/** The chart toolbar's first control: what the active chart is, a straddle or a scrip chart. */
function ChartKindPicker({ api }: Readonly<{ api: DockviewApi | null }>) {
  const active = useActivePanel();
  const component = active ? api?.getPanel(active)?.api.component : undefined;
  if (!api || !active || !isChartKind(component)) return null;
  return (
    <Dropdown<ChartKind>
      label="Chart"
      caption={false}
      value={component}
      onChange={(kind) => replaceChart(api, active, kind)}
      options={CHART_KINDS.map((k) => ({ value: k.kind, label: k.name, note: k.note }))}
    />
  );
}
