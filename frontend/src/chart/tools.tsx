import type { Chart } from "openalgo-charts"

import { CameraIcon, ResetViewIcon, ZoomInIcon, ZoomOutIcon } from "@/components/icons"
import { Tip, ToolButton } from "@/components/app/toolbar"

/**
 * Zoom out, zoom in, back to the default view, save as an image: the engine's own commands, from the
 * toolbar. When the bar runs out of room zoom gives way first (rank 2), then the camera (rank 3, into
 * the "more" menu where a chart has one); the keys always work.
 */
export function ChartTools({ chart, fileName }: { chart: Chart | null; fileName: string }) {
  return (
    <div className="flex items-center">
      <Tip label="Zoom out (-)">
        <ToolButton aria-label="Zoom out" data-drop="2" onClick={() => chart?.runCommand("zoomOut")}>
          <ZoomOutIcon />
        </ToolButton>
      </Tip>
      <Tip label="Zoom in (+)">
        <ToolButton aria-label="Zoom in" data-drop="2" onClick={() => chart?.runCommand("zoomIn")}>
          <ZoomInIcon />
        </ToolButton>
      </Tip>
      <Tip label="Reset view (Home)">
        <ToolButton aria-label="Reset view" data-drop="4" onClick={() => chart?.runCommand("resetScale")}>
          <ResetViewIcon />
        </ToolButton>
      </Tip>
      <Tip label="Save as image">
        <ToolButton aria-label="Save as image" data-drop="3" onClick={() => chart?.downloadScreenshot(fileName)}>
          <CameraIcon />
        </ToolButton>
      </Tip>
    </div>
  )
}
