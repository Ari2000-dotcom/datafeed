import type { Hub } from "../hub/client";
import { ChainPanel } from "../option/ChainPanel";
import { DeltaOiPanel } from "../greeks/DeltaOiPanel";
import { readPick } from "../straddle/StraddlePage";
import { edgeDrag, edgeKeys } from "../ui/edgeDrag";
import { ChainRailIcon, CloseThinIcon, DeltaOiRailIcon, DockBelowIcon } from "../ui/icons";
import { beginSideDrag, endSideDrag } from "./dockDrag";

/**
 * The right-hand rail and the panel it opens, TradingView's widget bar: an icon per panel (the
 * option chain, Delta × OI); a click opens that panel beside the charts, a second click or its
 * close shuts it. The panel follows the chart's pick as it always has (`useFollowedPick`), and the
 * chain's "+" still adds a straddle to the chart. Its left edge drags it wider or narrower.
 *
 * Delta × OI can also leave the side: its title is a handle to drag it onto the charts (beside,
 * above or below one, or over its middle to take its place), and the dock button beside the close
 * puts it under the active chart. Either way it becomes a cell of the grid (`Workspace`).
 */

export type SideId = "chain" | "deltaoi";

export const SIDE_ITEMS: readonly { id: SideId; name: string; Icon: () => JSX.Element }[] = [
  { id: "chain", name: "Option chain", Icon: ChainRailIcon },
  { id: "deltaoi", name: "Delta × OI", Icon: DeltaOiRailIcon },
];

export const SIDE_MIN = 280;
export const SIDE_MAX = 720;
export const SIDE_DEFAULT = 380;

export function Rail({ open, onToggle }: Readonly<{ open: SideId | null; onToggle: (id: SideId) => void }>) {
  return (
    <nav className="mh-rail mh-plate" aria-label="Panels">
      {SIDE_ITEMS.map(({ id, name, Icon }) => (
        <button key={id} type="button" className="mh-tool-btn" aria-pressed={open === id} aria-label={name} title={name} onClick={() => onToggle(id)}>
          <Icon />
        </button>
      ))}
    </nav>
  );
}

export function SidePanel({
  id,
  hub,
  width,
  onWidth,
  onClose,
  onDock,
}: Readonly<{ id: SideId; hub: Hub; width: number; onWidth: (width: number) => void; onClose: () => void; onDock?: () => void }>) {
  const name = SIDE_ITEMS.find((s) => s.id === id)?.name ?? "";
  const max = Math.min(SIDE_MAX, Math.round(window.innerWidth * 0.5));
  // Only Delta × OI is a kind of cell the grid draws; the chain stays in the side panel.
  const dockable = id === "deltaoi";
  return (
    <aside className="mh-side mh-plate" style={{ width }} aria-label={name}>
      <div
        className="mh-side-grip"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`Resize the ${name.toLowerCase()} panel`}
        aria-valuenow={width}
        aria-valuemin={SIDE_MIN}
        aria-valuemax={max}
        onPointerDown={(e) => edgeDrag(e, "x", -1, width, SIDE_MIN, max, onWidth)}
        onKeyDown={(e) => edgeKeys(e, "x", -1, width, SIDE_MIN, max, onWidth)}
      />
      <div
        className="mh-panel-head"
        data-draggable={dockable || undefined}
        data-panel-drag-handle={dockable ? "" : undefined}
        draggable={dockable}
        title={dockable ? "Drag onto the charts to dock it" : undefined}
        onDragStart={dockable ? (e) => beginSideDrag(e, id, name) : undefined}
        onDragEnd={dockable ? endSideDrag : undefined}
      >
        <span className="mh-panel-title">{name}</span>
        <span className="mh-spacer" />
        {dockable && onDock ? (
          <button type="button" className="mh-panel-close" aria-label={`Dock ${name} under the active chart`} title="Dock under the active chart" onClick={onDock}>
            <DockBelowIcon />
          </button>
        ) : null}
        <button type="button" className="mh-panel-close" aria-label={`Close ${name}`} title="Close" onClick={onClose}>
          <CloseThinIcon />
        </button>
      </div>
      <div className="mh-side-body">{id === "chain" ? <ChainPanel key="chain" hub={hub} initialPick={readPick()} /> : <DeltaOiPanel key="deltaoi" hub={hub} initialPick={readPick()} />}</div>
    </aside>
  );
}
