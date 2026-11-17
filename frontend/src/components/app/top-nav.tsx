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

/** Tabs along the bar, the active one marked by a filled pill. */
function NavTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-7 shrink-0 items-center rounded-md px-2.5 text-[13px] whitespace-nowrap outline-none transition-colors duration-150 hover:bg-selection hover:text-foreground focus-visible:text-foreground active:translate-y-px",
        active ? "bg-selection text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
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
    <header className="flex h-11 shrink-0 items-center gap-1 bg-chrome pr-2 pl-3">
      <a href={hrefOf.markets()} className="mr-4 flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring" aria-label="AlphaHedge, home" translate="no">
        <Logo />
        <span className="hidden font-heading text-[17px] leading-none font-semibold tracking-[-0.01em] sm:inline">Alpha<span className="text-primary">Hedge</span></span>
      </a>
      <nav aria-label="Primary" className="flex items-center gap-0.5">
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
          className="group inline-flex h-7 w-7 shrink-0 items-center justify-center gap-2 rounded-md bg-seg-track text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-selection hover:text-foreground md:w-56 md:justify-start md:pr-2 md:pl-2.5"
        >
          <SearchIcon />
          <span className="hidden md:inline">Search</span>
          {/* The shortcut as a keycap outline, not a filled block: a hairline edge, smaller corners than the field. */}
          <Kbd className="ml-auto hidden h-[18px] rounded-[4px] border border-separator-strong bg-transparent px-1.5 text-[11px] font-normal text-subtle transition-colors duration-150 group-hover:text-muted-foreground md:inline-flex">
            {isMac ? "⌘K" : "Ctrl K"}
          </Kbd>
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
