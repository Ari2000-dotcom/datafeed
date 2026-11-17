import { useState } from "react"

import { CommandMenu } from "@/components/app/command-menu"
import { IndexStrip } from "@/components/app/index-strip"
import { FeedNotice } from "@/components/app/status-cluster"
import { TopNav } from "@/components/app/top-nav"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ChainPage } from "@/pages/chain"
import { ChartsPage } from "@/pages/charts"
import { MarketsPage } from "@/pages/markets"
import { useRoute } from "@/lib/router"

export function App() {
  const route = useRoute()
  const [searching, setSearching] = useState(false)
  const [strip, setStrip] = useState(() => {
    try {
      return localStorage.getItem("ah:strip") !== "hidden"
    } catch {
      return true
    }
  })
  const showStrip = (on: boolean) => {
    setStrip(on)
    try {
      localStorage.setItem("ah:strip", on ? "shown" : "hidden")
    } catch {
      // A per-viewer convenience only.
    }
  }

  return (
    <TooltipProvider delayDuration={350}>
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-3 focus-visible:py-1.5 focus-visible:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="flex h-dvh flex-col">
        <TopNav onSearch={() => setSearching(true)} stripHidden={!strip} onShowStrip={() => showStrip(true)} />
        {strip ? <IndexStrip onHide={() => showStrip(false)} /> : null}
        <FeedNotice />
        {/* The content window: inset on the backdrop, 12px corners, a hairline ring, as the reference sets its pages. */}
        <main id="main" tabIndex={-1} className="outline-none mx-1.5 mb-1.5 min-h-0 flex-1 overflow-hidden rounded-[12px] bg-background shadow-window">
          {route.name === "chain" ? <ChainPage route={route} /> : route.name === "charts" ? <ChartsPage route={route} /> : <MarketsPage />}
        </main>
      </div>
      <CommandMenu open={searching} onOpenChange={setSearching} />
    </TooltipProvider>
  )
}

export default App
