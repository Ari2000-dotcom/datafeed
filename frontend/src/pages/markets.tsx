import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { AlertIcon, ChevronDownIcon, SearchIcon } from "@/components/icons"
import { Segmented } from "@/components/app/toolbar"
import { Section } from "@/components/app/section"

import {
  INDIA_ITEMS,
  OverviewPanel,
  commodityItems,
} from "@/components/app/market-summary"
import { WorldMarkets } from "@/components/app/world-markets"
import { MarketNews } from "@/components/app/market-news"
import { Move, TONE_TEXT } from "@/components/app/move"
import { RangeBar } from "@/components/app/range-bar"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  daysTo,
  expiryLabel,
  fmt0,
  fmt2,
  nearestExpiry,
  signed,
  toneOf,
  type Tone,
} from "@/lib/format"
import {
  EXCHANGE,
  GROUPS,
  commodityRank,
  featuredRank,
  groupOf,
  instrumentName,
  leaderOf,
  type MarketGroup,
} from "@/lib/instruments"
import { hrefOf, navigate } from "@/lib/router"
import { useDay } from "@/lib/use-day"
import { useReference, useUniverse, type Underlying } from "@/lib/use-hub"
import { useTickFlash } from "@/lib/use-tick-flash"
import { useWaited } from "@/lib/use-waited"
import { cn } from "@/lib/utils"

type Filter = "all" | "nse" | "bse" | "mcx"

const HEAD = "h-8 px-3 type-colhead"
const NUM_HEAD = cn(HEAD, "text-right")
const CELL = "h-10 px-3 py-0"

/** A leader with the contracts that follow it (its minis), in the order the table shows them. */
interface Family {
  leader: Underlying
  followers: Underlying[]
}

function familiesOf(rows: readonly Underlying[]): Family[] {
  const present = new Set(rows.map((u) => u.id))
  const follows = (u: Underlying) => {
    const lead = leaderOf(u.id)
    return lead && present.has(lead) ? lead : null
  }
  const families = rows
    .filter((u) => !follows(u))
    .map((leader): Family => ({ leader, followers: [] }))
  const byLeader = new Map(families.map((f) => [f.leader.id, f]))
  for (const u of rows) {
    const lead = follows(u)
    if (lead) byLeader.get(lead)?.followers.push(u)
  }
  return families
}

function MarketRow({
  u,
  follower = false,
  onTone,
}: {
  u: Underlying
  follower?: boolean
  onTone: (id: string, tone: Tone | null) => void
}) {
  const reference = useReference(u)
  const day = useDay(reference)
  const { quote } = day
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)
  const waited = useWaited(8_000)
  const market = u.id.split(":")[0]!
  const expiry = nearestExpiry(u.expiries)
  const days = expiry ? daysTo(expiry) : null
  const pending = !quote && !waited
  const tone = day.change !== null ? toneOf(day.change) : null

  useEffect(() => onTone(u.id, tone), [u.id, tone, onTone])

  return (
    <TableRow
      onClick={() => navigate(hrefOf.charts(u.id))}
      className="cursor-pointer"
    >
      <TableCell className={cn(CELL, follower ? "pl-9" : "pl-4")}>
        <div className="flex items-center">
          {follower ? (
            <span
              aria-hidden
              className="relative -top-1 mr-2 size-2.5 shrink-0 rounded-bl-[3px] border-b border-l border-input"
            />
          ) : null}
          <a
            href={hrefOf.charts(u.id)}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "outline-none hover:underline focus-visible:underline",
              follower ? "text-soft" : "text-foreground"
            )}
          >
            {instrumentName(u.id, u.name)}
          </a>
          {follower ? null : (
            <span className="ml-2 type-meta">{EXCHANGE[market]}</span>
          )}
        </div>
      </TableCell>
      <TableCell className={cn(CELL, "text-right")}>
        {quote ? (
          <span ref={flash} className="rounded-sm px-1 num text-foreground">
            {fmt2(quote.ltp)}
          </span>
        ) : pending ? (
          <Skeleton className="ml-auto h-4 w-16" />
        ) : (
          <span className="text-subtle">-</span>
        )}
      </TableCell>
      <TableCell
        className={cn(
          CELL,
          "text-right num",
          day.change !== null ? TONE_TEXT[toneOf(day.change)] : "text-subtle"
        )}
      >
        {day.change !== null ? (
          signed(day.change)
        ) : pending ? (
          <Skeleton className="ml-auto h-4 w-14" />
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell className={cn(CELL, "text-right")}>
        {day.pct !== null || !pending ? (
          <Move change={day.change} pct={day.pct} />
        ) : (
          <Skeleton className="ml-auto h-4 w-14" />
        )}
      </TableCell>
      <TableCell className={CELL}>
        <div className="flex items-center gap-2">
          <span className="w-[9ch] text-right num text-xs text-muted-foreground">
            {day.low !== null ? fmt2(day.low) : ""}
          </span>
          <RangeBar
            low={day.low}
            high={day.high}
            value={quote?.ltp}
            className="w-20 min-w-20 flex-1 xl:max-w-56"
          />
          <span className="w-[9ch] num text-xs text-muted-foreground">
            {day.high !== null ? fmt2(day.high) : ""}
          </span>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, "text-right num text-muted-foreground")}>
        {day.prevClose !== null ? fmt2(day.prevClose) : "-"}
      </TableCell>
      <TableCell className={cn(CELL, "text-right num")}>
        {expiry ? (
          <>
            {expiryLabel(expiry)}
            <span className="ml-2 inline-block w-[4ch] text-left text-subtle">
              {days === 0 ? "today" : `${days}d`}
            </span>
          </>
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell
        className={cn(CELL, "pr-4 text-right num text-muted-foreground")}
      >
        {fmt0(u.lot)}
      </TableCell>
    </TableRow>
  )
}

/** A group's heading row: its name, what it holds, and how many of its instruments are up and down on the day. */
function GroupRow({
  group,
  ids,
  tones,
  open,
  onToggle,
}: {
  group: MarketGroup
  ids: readonly string[]
  tones: Record<string, Tone | null>
  open: boolean
  onToggle: () => void
}) {
  return (
    <TableRow className="bg-background/40 hover:bg-background/40">
      <TableCell colSpan={8} className="h-9 p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex h-9 w-full items-center gap-3 px-4 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
        >
          <ChevronDownIcon
            size={12}
            className={cn(
              "shrink-0 text-subtle transition-transform duration-200",
              open ? "" : "-rotate-90"
            )}
          />
          <span data-card-title className="type-eyebrow text-foreground">{group.title}</span>
          <span className="num type-meta">{ids.length}</span>
          <span className="hidden type-meta sm:inline">{group.note}</span>
          <span className="ml-auto">
            <Breadth ids={ids} tones={tones} />
          </span>
        </button>
      </TableCell>
    </TableRow>
  )
}

/** How many of these are up and down on the day, in the moves' colours; grey while none has moved yet. */
function Breadth({
  ids,
  tones,
}: {
  ids: readonly string[]
  tones: Record<string, Tone | null>
}) {
  const up = ids.filter((id) => tones[id] === "up").length
  const down = ids.filter((id) => tones[id] === "down").length
  return (
    <span className="flex items-center gap-3 num text-xs">
      <span className={up ? "text-up" : "text-subtle"}>{up} up</span>
      <span className={down ? "text-down" : "text-subtle"}>{down} down</span>
    </span>
  )
}

function SkeletonRows() {
  return Array.from({ length: 9 }, (_, i) => (
    <TableRow key={i} className="hover:bg-transparent">
      <TableCell className={cn(CELL, "pl-4")}>
        <Skeleton className="h-4 w-28" />
      </TableCell>
      {Array.from({ length: 7 }, (_, j) => (
        <TableCell key={j} className={CELL}>
          <Skeleton className="ml-auto h-4 w-16" />
        </TableCell>
      ))}
    </TableRow>
  ))
}

export function MarketsPage() {
  const { list, loading, error } = useUniverse()
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [tones, setTones] = useState<Record<string, Tone | null>>({})
  const [closed, setClosed] = useState<
    Partial<Record<MarketGroup["key"], boolean>>
  >({})
  const onTone = useCallback(
    (id: string, tone: Tone | null) =>
      setTones((t) => (t[id] === tone ? t : { ...t, [id]: tone })),
    []
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.filter(
      (u) =>
        (filter === "all" || u.id.startsWith(`${filter}:`)) &&
        (!q ||
          u.name.toLowerCase().includes(q) ||
          instrumentName(u.id, u.name).toLowerCase().includes(q))
    )
  }, [list, filter, query])

  const commodities = useMemo(
    () =>
      list
        .filter((u) => u.id.startsWith("mcx:") && !leaderOf(u.id))
        .sort((a, b) => commodityRank(a.id) - commodityRank(b.id)),
    [list]
  )
  const commodityRows = useMemo(
    () => commodityItems(commodities),
    [commodities]
  )

  // Indices in the cards' order; commodities by nearest expiry (the universe's order), each mini under its leader.
  const groups = useMemo(
    () =>
      GROUPS.map((group) => {
        const members = rows.filter((u) => groupOf(u.id) === group.key)
        if (group.key === "index")
          members.sort((a, b) => featuredRank(a.id) - featuredRank(b.id))
        return { group, members, families: familiesOf(members) }
      }).filter((g) => g.members.length > 0),
    [rows]
  )

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">Markets</h1>
      <div className="min-h-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-3 pt-4 pb-10 sm:gap-10 sm:px-5 sm:pt-6 sm:pb-12">
          {/* Indices, commodities and the world side by side on a wide screen; two columns with the world under them on a laptop; one on a phone. Each is a QuantDesk container: a folder tab over its plate. */}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Section
              title="Indian indices"
              count={INDIA_ITEMS.length}
              aside={
<Breadth ids={INDIA_ITEMS.map((i) => i.id)} tones={tones} />
              }
            >
              <OverviewPanel
                panelKey="india"
                label="Indian indices"
                items={INDIA_ITEMS}
                onTone={onTone}
              />
            </Section>

            <Section
              title="MCX commodities"
              count={loading ? "" : commodities.length}
              aside={
<Breadth ids={commodities.map((u) => u.id)} tones={tones} />
              }
            >
              <OverviewPanel
                panelKey="mcx"
                label="MCX commodities"
                items={commodityRows}
                loading={loading}
                onTone={onTone}
              />
            </Section>

            <Section
              title="Global markets"
              count={8}
              className="lg:col-span-2 xl:col-span-1"
              aside={<span className="hidden type-meta md:inline">Times in IST</span>}
            >
              <WorldMarkets />
            </Section>
          </div>

          <MarketNews />

          <Section title="Options markets" flush
              count={
                loading
                  ? ""
                  : rows.length === list.length
                    ? list.length
                    : `${rows.length} of ${list.length}`
              }
              aside={
                <>
                  <span className="hidden type-meta lg:inline">Click a market to open its chart</span>
                  <Segmented
                    value={filter}
                    onChange={setFilter}
                    label="Exchange"
                    items={[
                      { value: "all", label: "All" },
                      { value: "nse", label: "NSE" },
                      { value: "bse", label: "BSE" },
                      { value: "mcx", label: "MCX" },
                    ]}
                  />
                  <InputGroup className="h-8 min-w-0 flex-1 sm:w-56 sm:flex-none">
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search markets"
                      aria-label="Search markets"
                    />
                  </InputGroup>
                </>
              }
          >
            {error ? (
              <Empty className="plate">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <AlertIcon />
                  </EmptyMedia>
                  <EmptyTitle>Markets are not available right now</EmptyTitle>
                  <EmptyDescription>Prices will appear here as soon as the connection is back. Try refreshing in a moment.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : !loading && rows.length === 0 ? (
              <Empty className="plate">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchIcon />
                  </EmptyMedia>
                  <EmptyTitle>No market matches “{query.trim()}”</EmptyTitle>
                  <EmptyDescription>
                    Check the spelling, clear the search or pick another exchange.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="overflow-hidden plate">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={cn(HEAD, "w-[22%] pl-4")}>
                        Market
                      </TableHead>
                      <TableHead className={NUM_HEAD}>Price</TableHead>
                      <TableHead className={NUM_HEAD}>Change</TableHead>
                      <TableHead className={NUM_HEAD}>Change %</TableHead>
                      <TableHead className={cn(HEAD, "pl-[calc(0.75rem+9ch+0.5rem)]")}>Day range</TableHead>
                      <TableHead className={NUM_HEAD}>Prev close</TableHead>
                      <TableHead className={NUM_HEAD}>Next expiry</TableHead>
                      <TableHead className={cn(NUM_HEAD, "pr-4")}>
                        Lot size
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <SkeletonRows />
                    ) : (
                      groups.map(({ group, members, families }) => {
                        const open = !closed[group.key]
                        return (
                          <Fragment key={group.key}>
                            <GroupRow
                              group={group}
                              ids={members.map((u) => u.id)}
                              tones={tones}
                              open={open}
                              onToggle={() =>
                                setClosed((c) => ({ ...c, [group.key]: open }))
                              }
                            />
                            {open
                              ? families.map(({ leader, followers }) => (
                                  <Fragment key={leader.id}>
                                    <MarketRow u={leader} onTone={onTone} />
                                    {followers.map((f) => (
                                      <MarketRow
                                        key={f.id}
                                        u={f}
                                        follower
                                        onTone={onTone}
                                      />
                                    ))}
                                  </Fragment>
                                ))
                              : null}
                          </Fragment>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
