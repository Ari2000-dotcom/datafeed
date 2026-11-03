import { ChevronDownIcon, MoreIcon, SearchIcon } from "@/components/icons"
import { Tip, ToolButton } from "@/components/app/toolbar"

import { LayoutMenu } from "@/components/app/layout-menu"
import { Logo } from "@/components/app/logo"
import { FeedStatus, StatusCluster } from "@/components/app/status-cluster"
import { useTheme } from "@/components/theme-provider"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { hrefOf, useRoute } from "@/lib/router"
import { cn } from "@/lib/utils"

const NAV = [
  { name: "markets", label: "Markets", short: "Markets", href: hrefOf.markets() },
  { name: "charts", label: "Charts", short: "Charts", href: hrefOf.charts() },
  { name: "chain", label: "Option chain", short: "Chain", href: hrefOf.chain() },
] as const

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

/** Tabs along the bar, the active one marked by a line on the bar's bottom edge. */
function NavTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-10 shrink-0 items-center px-3 text-sm font-medium whitespace-nowrap outline-none sm:px-3 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
      {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-primary" aria-hidden /> : null}
    </a>
  )
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <Tip label="Settings">
        <DropdownMenuTrigger asChild>
          <ToolButton aria-label="Settings">
            <MoreIcon />
          </ToolButton>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as "dark" | "light" | "system")}>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TopNav({ onSearch, stripHidden, onShowStrip }: { onSearch: () => void; stripHidden: boolean; onShowStrip: () => void }) {
  const route = useRoute()
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b bg-chrome pr-2 pl-3">
      <a href={hrefOf.markets()} className="mr-3 flex items-center gap-2 outline-none focus-visible:ring-1 focus-visible:ring-ring" aria-label="AlphaHedge, home">
        <Logo />
        <span className="hidden text-base font-semibold tracking-tight sm:inline">AlphaHedge</span>
      </a>
      <nav aria-label="Primary" className="flex items-center">
        {NAV.map((item) => (
          <NavTab key={item.name} href={item.href} active={route.name === item.name}>
            <span className="sm:hidden">{item.short}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </NavTab>
        ))}
      </nav>

      {route.name === "charts" ? (
        <div className="ml-2 hidden sm:block">
          <LayoutMenu />
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-3">
        {stripHidden ? (
          <Tip label="Show the indices strip">
            <ToolButton onClick={onShowStrip} className="gap-1 text-xs">
              Indices
              <ChevronDownIcon size={12} />
            </ToolButton>
          </Tip>
        ) : null}
        {/* A quiet field, not a box: a fill a step off the bar, the hint and the key. It is a way in, so it stays small. */}
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search instruments"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-md bg-seg-track text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring md:w-56 md:justify-start md:pr-1.5 md:pl-2.5"
        >
          <SearchIcon />
          <span className="hidden md:inline">Search</span>
          <Kbd className="ml-auto hidden md:inline-flex">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
        </button>
        <div className="hidden lg:block">
          <StatusCluster />
        </div>
        <FeedStatus className="lg:hidden" />
        <ThemeMenu />
      </div>
    </header>
  )
}
