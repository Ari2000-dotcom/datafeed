import { useEffect, useMemo } from "react"
import { withAlpha, type LinePoint } from "openalgo-charts"

import { chartTheme, cssColor } from "@/chart/theme"
import { useChart } from "@/chart/use-chart"
import { fmt2, istParts } from "@/lib/format"
import type { Candle } from "@/lib/history"
import { tradingHours } from "@/lib/session"
import { cn } from "@/lib/utils"

/**
 * One session on the chart engine the Charts page uses: a baseline at the previous close, green above
 * it and red below, with the engine's own price and time axes and crosshair. The line runs on the
 * session's clock (empty slots up to the close), so a morning reads as a morning. A glance chart: no
 * pan or zoom; the panel's "Open chart" goes to the full one.
 */
export function SessionChart({
  id,
  bars,
  last,
  prevClose,
  height = 190,
  className,
}: {
  id: string
  bars: readonly Candle[]
  /** The live price: the latest bar closes on it. */
  last?: number
  prevClose: number | null
  /** The whole chart's height in pixels, time axis included. */
  height?: number
  className?: string
}) {
  const { host, chart, colors } = useChart({ still: true })

  // Closes on the session's own clock; the latest closes on the live price. The rest of the session is
  // kept as empty room on the right (the view range, below), so a morning reads as a morning. Empty
  // data slots would do the same, but the baseline's fill runs on through them to the edge.
  const data = useMemo(() => {
    if (bars.length < 2) return null
    const points: LinePoint[] = bars.map((b) => ({
      time: b.time,
      value: b.close,
    }))
    if (last !== undefined)
      points[points.length - 1] = {
        time: bars[bars.length - 1]!.time,
        value: last,
      }
    return points
  }, [bars, last])

  const slotsLeft = useMemo(() => {
    if (bars.length === 0) return 0
    const { end } = tradingHours(id)
    return Math.max(
      0,
      Math.floor(
        (end - istParts(bars[bars.length - 1]!.time * 1000).minutes) / 5
      ) - 1
    )
  }, [bars, id])

  const base = prevClose ?? bars[0]?.open ?? null

  // The canvas takes the panel's ground, so the chart reads as part of the card and not a box inside it.
  useEffect(() => {
    if (!chart || !colors) return
    chart.setTheme(
      chartTheme({
        ...colors,
        ground: cssColor("--card"),
        grid: cssColor("--card"),
      })
    )
  }, [chart, colors])

  useEffect(() => {
    if (!chart || !colors || !data || base === null) return
    const series = chart.addSeries("baseline", {
      priceScaleId: "right",
      paneIndex: 0,
      priceFormat: { type: "custom", formatter: fmt2 },
      style: {
        baseValue: base,
        // The last-price tag in the colour of where the price sits against the previous close.
        color: data[data.length - 1]!.value >= base ? colors.up : colors.down,
        topColor: colors.up,
        bottomColor: colors.down,
        areaTopColor: withAlpha(colors.up, 0.16),
        areaBottomColor: withAlpha(colors.down, 0.16),
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: false,
      },
    })
    series.setData(data)
    const reference =
      prevClose !== null
        ? chart.addPriceLine({
            id: "prev-close",
            price: prevClose,
            color: colors.muted,
            lineStyle: "dotted",
            label: fmt2(prevClose),
          })
        : null
    chart.setVisibleLogicalRange({
      from: -0.5,
      to: data.length - 0.5 + slotsLeft,
    })
    return () => {
      if (reference) chart.removePrimitive(reference)
      series.remove()
    }
  }, [chart, colors, data, base, prevClose, slotsLeft])

  if (bars.length < 2)
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed type-meta",
          className
        )}
        style={{ height }}
      >
        No intraday history for this session
      </div>
    )

  return (
    <div ref={host} className={cn("w-full", className)} style={{ height }} />
  )
}
