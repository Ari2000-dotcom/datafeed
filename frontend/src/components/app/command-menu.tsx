import { useEffect } from "react"

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { expiryLabel, nearestExpiry } from "@/lib/format"
import { instrumentName } from "@/lib/instruments"
import { hrefOf, navigate } from "@/lib/router"
import { useUniverse } from "@/lib/use-hub"

const EXCHANGE: Record<string, string> = { nse: "NSE", bse: "BSE", mcx: "MCX" }

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true']")
}

/** Jump anywhere: a screen, or an underlying's option chain. Opens on Ctrl K (Cmd K) or "/". */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { list, loading } = useUniverse()

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

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search instruments" description="Jump to a screen or an option chain.">
      <CommandInput placeholder="Find an instrument or a screen" />
      <CommandList>
        <CommandEmpty>{loading ? "Loading instruments..." : "Nothing matches that."}</CommandEmpty>
        <CommandGroup heading="Screens">
          <CommandItem value="markets screen" onSelect={() => go(hrefOf.markets())}>
            Markets
          </CommandItem>
          <CommandItem value="charts screen price straddle delta" onSelect={() => go(hrefOf.charts())}>
            Charts
          </CommandItem>
          <CommandItem value="option chain screen" onSelect={() => go(hrefOf.chain())}>
            Option chain
          </CommandItem>
        </CommandGroup>
        {list.length > 0 ? (
          <CommandGroup heading="Option chains">
            {list.map((u) => {
              const expiry = nearestExpiry(u.expiries)
              return (
                <CommandItem key={u.id} value={`${u.name} ${u.id}`} onSelect={() => go(hrefOf.chain(u.id))}>
                  <span className="font-medium">{instrumentName(u.id, u.name)}</span>
                  <span className="text-muted-foreground">{EXCHANGE[u.id.split(":")[0]!] ?? ""}</span>
                  {expiry ? <span className="num ml-auto text-xs text-muted-foreground">{expiryLabel(expiry)}</span> : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
