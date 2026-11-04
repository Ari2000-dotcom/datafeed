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
      <div className="flex h-dvh flex-col">
        <TopNav onSearch={() => setSearching(true)} stripHidden={!strip} onShowStrip={() => showStrip(true)} />
        {strip ? <IndexStrip onHide={() => showStrip(false)} /> : null}
        <FeedNotice />
        <main className="min-h-0 flex-1">
          {route.name === "chain" ? <ChainPage route={route} /> : route.name === "charts" ? <ChartsPage route={route} /> : <MarketsPage />}
        </main>
      </div>
      <CommandMenu open={searching} onOpenChange={setSearching} />
    </TooltipProvider>
  )
}

export default App
