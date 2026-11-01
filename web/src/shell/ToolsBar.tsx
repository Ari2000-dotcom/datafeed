import type { ReactNode } from "react";

import { chartOf, setCursorTool, useCursorTool } from "../chart/registry";
import { istDate } from "../core/format";
import { CameraToolIcon, CrosshairToolIcon, MagnetToolIcon, MeasureToolIcon, ResetViewToolIcon, ZoomInToolIcon, ZoomOutToolIcon } from "../ui/icons";
import { useActivePanel } from "./headerSlot";

/**
 * The left tools bar, TradingView's drawing bar with the tools this desk has so far: the cursor
 * (crosshair, magnet that snaps to the bar's open, high, low or close, measure), then zoom in, zoom
 * out and back to the default view on the active chart, and the active chart saved as an image.
 * The cursor applies to every chart, as it does on TradingView.
 */
export function ToolsBar() {
  const tool = useCursorTool();
  const active = useActivePanel();
  const run = (command: string) => chartOf(active)?.runCommand(command);
  return (
    <aside className="mh-tools mh-plate" aria-label="Chart tools">
      <Tool label="Crosshair" pressed={tool === "cross"} onClick={() => setCursorTool("cross")}>
        <CrosshairToolIcon />
      </Tool>
      <Tool label="Magnet: snap to the bar's open, high, low or close" pressed={tool === "magnet"} onClick={() => setCursorTool("magnet")}>
        <MagnetToolIcon />
      </Tool>
      <Tool label="Measure: drag across a chart (Esc clears)" pressed={tool === "measure"} onClick={() => setCursorTool(tool === "measure" ? "cross" : "measure")}>
        <MeasureToolIcon />
      </Tool>
      <span className="mh-tools-sep" aria-hidden />
      <Tool label="Zoom in" onClick={() => run("zoomIn")}>
        <ZoomInToolIcon />
      </Tool>
      <Tool label="Zoom out" onClick={() => run("zoomOut")}>
        <ZoomOutToolIcon />
      </Tool>
      <Tool label="Reset the chart's view" onClick={() => run("resetScale")}>
        <ResetViewToolIcon />
      </Tool>
      <span className="mh-tools-sep" aria-hidden />
      <Tool label="Save the chart as an image" onClick={() => chartOf(active)?.downloadScreenshot(`alphahedge-${istDate(Date.now())}.png`)}>
        <CameraToolIcon />
      </Tool>
    </aside>
  );
}

function Tool({ label, pressed, onClick, children }: Readonly<{ label: string; pressed?: boolean; onClick: () => void; children: ReactNode }>) {
  return (
    <button type="button" className="mh-tool-btn" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}
