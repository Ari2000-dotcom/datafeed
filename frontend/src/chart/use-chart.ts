import { useEffect, useRef, useState } from "react"
import { createChart, type Chart } from "openalgo-charts"

import { chartTheme, palette, priceAxisWidth, useScheme, type Palette } from "@/chart/theme"

/**
 * One engine chart in a host element, created once Inter has loaded (the canvas measures its
 * text in it) and rebuilt when the page changes between dark and light. `chart` is null until
 * then, so a series is added in an effect that depends on it.
 */
export function useChart(options?: { minBarSpacing?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ chart: Chart; colors: Palette } | null>(null)
  const scheme = useScheme()

  useEffect(() => {
    const element = host.current
    if (!element) return
    let disposed = false
    let created: Chart | null = null
    document.fonts
      .load("12px 'Inter Hinted'")
      .catch(() => undefined)
      .then(() => {
        if (disposed) return
        const colors = palette()
        created = createChart(element, {
          timezone: "Asia/Kolkata",
          theme: chartTheme(colors),
          priceAxisWidth: priceAxisWidth(),
          crosshairSnapToBar: true,
          branding: false,
          navigation: { mousePan: "both" },
          // The countdown only makes sense while trades come in; a closed market would count to nothing.
          axisChrome: { barCountdown: false },
          // A panel that grows or shrinks keeps the same bars in view.
          // The thinnest a bar may get, px. The default is 1; the price chart passes less so a few days of 1m bars fit.
          timeScale: { lockVisibleTimeRangeOnResize: true, ...(options?.minBarSpacing ? { minBarSpacing: options.minBarSpacing } : {}) },
        })
        setState({ chart: created, colors })
      })
    // The canvas reads its colours once; when the stylesheet changes under it (a hot update while
    // developing) it reads them again, so the canvas changes with the page instead of on a reload.
    const restyle = () => {
      if (!created) return
      const colors = palette()
      created.setTheme(chartTheme(colors))
      setState({ chart: created, colors })
    }
    import.meta.hot?.on("vite:afterUpdate", restyle)
    return () => {
      import.meta.hot?.off("vite:afterUpdate", restyle)
      disposed = true
      created?.destroy()
      setState(null)
    }
  }, [scheme])

  return { host, chart: state?.chart ?? null, colors: state?.colors ?? null }
}
