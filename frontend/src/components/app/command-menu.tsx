import { useEffect, useMemo } from "react"

import { Move } from "@/components/app/move"
import { AreaChartIcon, CandlesIcon, StraddleIcon } from "@/components/icons"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { expiryLabel, fmt2, nearestExpiry } from "@/lib/format"
import { commodityRank, featuredRank, instrumentName, leaderOf } from "@/lib/instruments"
import { hrefOf, navigate } from "@/lib/router"
import { useQuote, useUniverse, type Underlying } from "@/lib/use-hub"
import { cn } from "@/lib/utils"

const EXCHANGE: Record<string, string> = { nse: "NSE", bse: "BSE", mcx: "MCX" }

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true']")
}

/** A key as a keycap outline, the same as the search bar's. */
function Key({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-separator-strong px-1 font-sans text-[11px] text-muted-foreground", className)}>
      {children}
    </kbd>
  )
}

/** A rounded square holding a row's icon or exchange, so every row starts on the same column. */
function Tile({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-seg-track text-soft [&_svg]:size-6!">
      {children}
    </span>
  )
}

/** One market: exchange tile, name, where it trades and its next expiry, its live price. Enter opens the chart. */
function MarketItem({ u, onChart, onChain }: { u: Underlying; onChart: () => void; onChain: () => void }) {
  const exchange = u.id.split(":")[0]!
  // Indices quote on themselves; a commodity's price is its front future, which is left to its chart.
  const quote = useQuote(exchange === "mcx" ? null : u.id)
  const expiry = nearestExpiry(u.expiries)
  const change = quote?.pc ? quote.ltp - quote.pc : null
  const name = instrumentName(u.id, u.name)
  return (
    <CommandItem value={`${name} ${u.name} ${u.id}`} onSelect={onChart}>
      <Tile>
        <span className="text-[10px] font-semibold tracking-[0.02em]">{EXCHANGE[exchange] ?? ""}</span>
      </Tile>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-foreground">{name}</span>
        <span className="truncate type-meta">
          {exchange === "mcx" ? "Commodity" : "Index"}
          {expiry ? ` · next expiry ${expiryLabel(expiry)}` : ""}
        </span>
      </span>
      {quote ? (
        <span className="flex shrink-0 flex-col items-end">
          <span className="num text-[13px] text-foreground">{fmt2(quote.ltp)}</span>
          {change !== null && quote.pc ? <Move change={change} pct={(change / quote.pc) * 100} className="text-[11px]" /> : null}
        </span>
      ) : null}
      {/* The chain is a second way in, shown on the row the keys or the pointer are on. */}
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation()
          onChain()
        }}
        className="hidden h-6 shrink-0 items-center rounded-md border border-separator-strong px-2 text-[11px] text-soft transition-colors duration-150 group-data-selected/command-item:inline-flex hover:bg-selection hover:text-foreground"
      >
        Chain
      </button>
    </CommandItem>
  )
}

/** Jump anywhere: a screen, or a market's chart or option chain. Opens on Ctrl K (Cmd K) or "/". */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { list: universe, loading } = useUniverse()
  // The Markets page's order: indices as its cards list them, then commodities, each mini after its leader.
  const list = useMemo(() => {
    const rank = (u: Underlying) => {
      const lead = leaderOf(u.id) ?? u.id
      const base = lead.startsWith("mcx:") ? 100 + commodityRank(lead) : featuredRank(lead)
      return base * 2 + (leaderOf(u.id) ? 1 : 0)
    }
    return [...universe].sort((a, b) => rank(a) - rank(b))
  }, [universe])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !isTyping(e.target) && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  const go = (href: string) => {
    onOpenChange(false)
    navigate(href)
  }

  const screens = [
    { label: "Markets", hint: "Indices, commodities, world and news", value: "markets screen home news", href: hrefOf.markets(), icon: <AreaChartIcon /> },
    { label: "Charts", hint: "Price, straddle and Delta × OI", value: "charts screen price straddle delta", href: hrefOf.charts(), icon: <CandlesIcon /> },
    { label: "Option chain", hint: "Strikes, OI and change", value: "option chain screen strikes", href: hrefOf.chain(), icon: <StraddleIcon /> },
  ]

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Jump to a market's chart or option chain, or to a screen.">
      <CommandInput placeholder="Search a market or a screen" aside={<Key>Esc</Key>} />
      <CommandList>
        <CommandEmpty>{loading ? "Loading markets…" : "No market or screen matches that."}</CommandEmpty>
        {list.length > 0 ? (
          <CommandGroup heading="Markets">
            {list.map((u) => (
              <MarketItem key={u.id} u={u} onChart={() => go(hrefOf.charts(u.id))} onChain={() => go(hrefOf.chain(u.id))} />
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Screens">
          {screens.map((s) => (
            <CommandItem key={s.label} value={s.value} onSelect={() => go(s.href)}>
              <Tile>{s.icon}</Tile>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] text-foreground">{s.label}</span>
                <span className="truncate type-meta">{s.hint}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="flex h-10 shrink-0 items-center gap-4 border-t px-4 type-meta">
        <span className="flex items-center gap-1.5">
          <Key>↑</Key>
          <Key>↓</Key>
          Move
        </span>
        <span className="flex items-center gap-1.5">
          <Key>Enter</Key>
          Open chart
        </span>
        <span className="ml-auto hidden sm:inline">{list.length ? `${list.length} markets` : ""}</span>
      </div>
    </CommandDialog>
  )
}
