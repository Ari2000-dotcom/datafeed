import { useMemo, useState } from "react"

import { Section } from "@/components/app/section"
import { Move } from "@/components/app/move"
import { Segmented } from "@/components/app/toolbar"
import { Skeleton } from "@/components/ui/skeleton"
import { dateLabel, istClock, istDate } from "@/lib/format"
import { ago, useNews, type MarketId, type NewsTopic, type Story } from "@/lib/news"
import { hrefOf } from "@/lib/router"
import { useDay } from "@/lib/use-day"
import { useNow } from "@/lib/use-now"
import { useQuote, useReference, useUniverse, type Underlying } from "@/lib/use-hub"
import { cn } from "@/lib/utils"

type Filter = "all" | "high" | "Policy" | "India" | "Global" | "Commodities"

/** The wire shows the newest this many; the rest still count in the markets in the news. */
const WIRE_ROWS = 150

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high", label: "High impact" },
  { value: "Policy", label: "Policy" },
  { value: "India", label: "India" },
  { value: "Global", label: "Global" },
  { value: "Commodities", label: "Commodities" },
]

/** Indian policy makers: their label takes the accent, the rest stay neutral. */
const MARKET_NAME: Record<MarketId, string> = {
  "nse:nifty": "Nifty 50",
  "nse:banknifty": "Nifty Bank",
  "bse:sensex": "Sensex",
  "nse:finnifty": "Fin Nifty",
  "nse:midcpnifty": "Midcap Select",
  "nse:indiavix": "India VIX",
  "mcx:crudeoil": "Crude oil",
  "mcx:gold": "Gold",
  "mcx:silver": "Silver",
  "mcx:naturalgas": "Natural gas",
  "mcx:copper": "Copper",
  "global:usdinr": "USD INR",
  "global:spx": "S&P 500",
  "global:nasdaq100": "Nasdaq 100",
  "global:dji": "Dow Jones",
  "global:nikkei": "Nikkei 225",
  "global:hsi": "Hang Seng",
  "global:giftnifty": "GIFT Nifty",
}

const matches = (s: Story, filter: Filter, market: MarketId | null) =>
  (market === null || s.markets.includes(market)) &&
  (filter === "all" ||
    (filter === "high"
      ? s.level === "high"
      : filter === "India" || filter === "Global"
        ? s.region === filter
        : s.topics.includes(filter as NewsTopic)))

/** A headline that opens its article: the title in its ink, an underline on hover only. */
const HEADLINE_HOVER = "group-hover:underline group-hover:decoration-separator-strong group-hover:underline-offset-4"

/** Who said it, before the headline: "Finance Minister", "RBI", "Fed". Indian policy makers in the accent. */
function Actor({ name }: { name: string | null }) {
  if (!name) return null
  return (
    <span
      className={cn(
        "relative -top-px mr-2 inline-flex h-[18px] items-center rounded-[4px] px-1.5 align-middle text-[11px]",
        "bg-seg-track text-soft"
      )}
    >
      {name}
    </span>
  )
}

// --- a market's live move, whatever kind of market it is -------------------------------------

/** Today's move of a market a story names: an index on itself, a commodity on its front future, a world market on its quote. */
function useMarketMove(id: MarketId, universe: readonly Underlying[]): { change: number | null; pct: number | null } {
  const global = id.startsWith("global:")
  const commodity = useMemo(() => (id.startsWith("mcx:") ? universe.find((u) => u.id === id) : undefined), [id, universe])
  const reference = useReference(commodity)
  const day = useDay(global ? null : commodity ? reference : id)
  const quote = useQuote(global ? id : null)
  if (global) {
    if (!quote?.pc) return { change: null, pct: null }
    const change = quote.ltp - quote.pc
    return { change, pct: (change / quote.pc) * 100 }
  }
  return { change: day.change, pct: day.pct }
}

/** A market a headline names, with its move today. Opens the market's chart when there is one. */
function MarketChip({ id, universe }: { id: MarketId; universe: readonly Underlying[] }) {
  const move = useMarketMove(id, universe)
  const body = (
    <>
      <span className="text-soft">{MARKET_NAME[id]}</span>
      <Move change={move.change} pct={move.pct} className="text-[11px]" />
    </>
  )
  const cls =
    "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[5px] bg-seg-track px-1.5 text-[11px] leading-none transition-colors duration-150"
  return id.startsWith("global:") ? (
    <span className={cls}>{body}</span>
  ) : (
    // A story row is itself a link, and a link cannot hold a link: this chip is a span that acts as one.
    <span
      role="link"
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        window.location.hash = hrefOf.charts(id)
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return
        e.preventDefault()
        e.stopPropagation()
        window.location.hash = hrefOf.charts(id)
      }}
      className={cn(cls, "cursor-pointer hover:bg-selection")}
      title={`Open the ${MARKET_NAME[id]} chart`}
    >
      {body}
    </span>
  )
}

function Chips({ story, universe, max = 3 }: { story: Story; universe: readonly Underlying[]; max?: number }) {
  if (story.markets.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {story.markets.slice(0, max).map((m) => (
        <MarketChip key={m} id={m} universe={universe} />
      ))}
    </span>
  )
}

/** "Business Standard, Mint +2": who carried it, the first two by name. */
function sourcesLine(story: Story): string {
  const [a, b, ...rest] = story.sources
  return `${a}${b ? `, ${b}` : ""}${rest.length ? ` +${rest.length}` : ""}`
}

/** The story's first topic; "Global" is not said of an Indian outlet's story with nothing more specific. */
const topicOf = (s: Story): string | undefined => s.topics.find((t) => t !== "Global" || s.region === "Global")

/** Source, then topic, parted by a middle dot: one quiet line under a headline. */
function Meta({ story, className }: { story: Story; className?: string }) {
  const topic = topicOf(story)
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 type-meta", className)}>
      <span className="truncate">{sourcesLine(story)}</span>
      {topic ? (
        <>
          <span aria-hidden className="text-subtle/60">·</span>
          <span className="shrink-0">{topic}</span>
        </>
      ) : null}
    </span>
  )
}

/** A picture from the article, hidden when the publisher refuses it. */
function Thumb({ src, className }: { src: string | null; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return null
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className={cn("shrink-0 rounded-md bg-seg-track object-cover", className)}
    />
  )
}

// --- the top story ---------------------------------------------------------------------------------

/** The story most likely to move Indian prices right now, set large: picture, speaker, headline, what it says. */
function Lead({ story, universe, now }: { story: Story; universe: readonly Underlying[]; now: number }) {
  const { lead } = story
  return (
    <a
      href={lead.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col gap-3 p-4 outline-none transition-colors duration-150 hover:bg-zebra"
    >
      <Thumb src={lead.image} className="h-[180px] w-full rounded-lg shadow-card" />
      <span className="flex items-center gap-1.5 type-meta">
        <span className="text-soft">Top story</span>
        {story.sources.length > 1 ? (
          <>
            <span aria-hidden className="text-subtle/60">·</span>
            <span>{story.sources.length} sources</span>
          </>
        ) : null}
        <span aria-hidden className="text-subtle/60">·</span>
        <span className="num">{ago(story.at, now)} ago</span>
      </span>
      <h3 className={cn("text-[19px] leading-[26px] text-foreground [text-wrap:balance]", HEADLINE_HOVER)}>
        <Actor name={story.actor} />
        {lead.title}
      </h3>
      {lead.summary ? <p className="line-clamp-3 max-w-[62ch] text-[13px] leading-5 text-muted-foreground [text-wrap:pretty]">{lead.summary}</p> : null}
      <span className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <span className="type-meta">{sourcesLine(story)}</span>
        <Chips story={story} universe={universe} max={4} />
      </span>
    </a>
  )
}

// --- who's speaking --------------------------------------------------------------------------------

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
      <span data-card-title className="text-[13px]">
        {title}
      </span>
      {note ? <span className="type-meta">{note}</span> : null}
    </div>
  )
}

/**
 * The latest from each policy maker and power the market listens to (Finance Minister, RBI, SEBI,
 * the Fed, OPEC…): one row each, the speaker in a column of its own so the list reads down it.
 */
function WhosSpeaking({ stories, now }: { stories: readonly Story[]; now: number }) {
  const latest = useMemo(() => {
    const byActor = new Map<string, Story>()
    for (const s of stories) {
      if (!s.actor) continue
      const had = byActor.get(s.actor)
      if (!had || s.at > had.at) byActor.set(s.actor, s)
    }
    return [...byActor.values()].sort((a, b) => b.at - a.at).slice(0, 6)
  }, [stories])
  if (latest.length === 0) return null
  return (
    <div className="border-t pb-2">
      <SectionHead title="Who's speaking" note="Latest from each" />
      {latest.map((s) => (
        <a
          key={s.key}
          href={s.lead.link}
          target="_blank"
          rel="noopener noreferrer"
          // A phone puts the speaker and time on one line and the headline under them; wider, three columns.
          className="group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 px-4 py-2 outline-none transition-colors duration-150 hover:bg-zebra sm:grid-cols-[7.5rem_minmax(0,1fr)_auto]"
        >
          <span className="order-1 flex min-w-0 items-center gap-2">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", "bg-subtle")} />
            <span className={"truncate text-[12px] text-soft"}>{s.actor}</span>
          </span>
          <span className={cn("order-3 col-span-2 line-clamp-2 text-[13px] leading-5 text-foreground [text-wrap:pretty] sm:order-2 sm:col-span-1", HEADLINE_HOVER)}>
            {s.lead.title}
          </span>
          <span className="order-2 num type-meta sm:order-3">{ago(s.at, now)}</span>
        </a>
      ))}
    </div>
  )
}

// --- markets in the news ---------------------------------------------------------------------------

function InTheNewsRow({
  id,
  count,
  most,
  picked,
  onPick,
  universe,
}: {
  id: MarketId
  count: number
  most: number
  picked: boolean
  onPick: () => void
  universe: readonly Underlying[]
}) {
  const move = useMarketMove(id, universe)
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      title={picked ? "Show every market" : `Show only stories on ${MARKET_NAME[id]}`}
      className={cn(
        "grid h-8 w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2rem_4.5rem] items-center gap-3 px-4 text-left transition-colors duration-150 outline-none",
        picked ? "bg-selection" : "hover:bg-zebra"
      )}
    >
      <span className={cn("truncate text-[13px]", picked ? "text-foreground" : "text-soft")}>{MARKET_NAME[id]}</span>
      <span className="h-1 overflow-hidden rounded-full bg-seg-track" aria-hidden>
        <span
          className={cn("block h-full rounded-full transition-[width] duration-300", picked ? "bg-primary" : "bg-foreground/30")}
          style={{ width: `${Math.max(6, (count / most) * 100)}%` }}
        />
      </span>
      <span className="text-right num type-meta">{count}</span>
      <span className="text-right">
        <Move change={move.change} pct={move.pct} className="text-xs" />
      </span>
    </button>
  )
}

/** Which of our markets the day's stories are about, most covered first, each with its move. Click to filter. */
function InTheNews({
  stories,
  market,
  onMarket,
  universe,
}: {
  stories: readonly Story[]
  market: MarketId | null
  onMarket: (m: MarketId | null) => void
  universe: readonly Underlying[]
}) {
  const ranked = useMemo(() => {
    const counts = new Map<MarketId, number>()
    for (const s of stories) for (const m of s.markets) counts.set(m, (counts.get(m) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [stories])
  if (ranked.length === 0) return null
  const most = ranked[0]![1]
  return (
    <div className="border-t pb-3">
      <SectionHead title="Markets in the news" note={market ? "Click again to show all" : "Stories · today's move"} />
      {ranked.map(([id, count]) => (
        <InTheNewsRow
          key={id}
          id={id}
          count={count}
          most={most}
          picked={market === id}
          onPick={() => onMarket(market === id ? null : id)}
          universe={universe}
        />
      ))}
    </div>
  )
}

// --- the wire ------------------------------------------------------------------------------------

/**
 * One story in the wire. A high-impact story carries an accent edge and the brightest ink; the rest
 * sit a step quieter, so the eye lands on what moves prices without a badge on every row.
 */
function WireRow({ story, fresh, universe }: { story: Story; fresh: boolean; universe: readonly Underlying[] }) {
  const { lead } = story
  const high = story.level === "high"
  return (
    <a
      href={lead.link}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 border-b px-4 py-3 outline-none transition-colors duration-150 last:border-b-0 hover:bg-zebra md:grid-cols-[3.25rem_minmax(0,1fr)_auto]",
        high && "shadow-[inset_2px_0_0_var(--primary)]"
      )}
    >
      <span className="flex items-start gap-1.5 pt-px">
        {fresh ? <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-foreground" aria-label="New" /> : null}
        <span className="num text-[12px] leading-5 text-subtle">{istClock(story.at).slice(0, 5)}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className={cn("line-clamp-2 text-[13px] leading-5 [text-wrap:pretty]", high ? "text-foreground" : "text-soft", HEADLINE_HOVER)}>
          <Actor name={story.actor} />
          {lead.title}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <Meta story={story} />
          <Chips story={story} universe={universe} />
        </span>
      </span>
      <Thumb src={lead.image} className="hidden h-[52px] w-[78px] md:block" />
    </a>
  )
}

/** Where a story falls on the clock: the last hour, earlier today, yesterday, or its date. */
function bucketOf(at: number, now: number): string {
  if (now - at < 3600_000) return "Last hour"
  const d = istDate(at)
  if (d === istDate(now)) return "Earlier today"
  if (d === istDate(now - 86_400_000)) return "Yesterday"
  return dateLabel(d)
}

function Wire({ stories, fresh, universe, now }: { stories: readonly Story[]; fresh: ReadonlySet<string>; universe: readonly Underlying[]; now: number }) {
  const buckets: { name: string; items: Story[] }[] = []
  for (const s of stories) {
    const name = bucketOf(s.at, now)
    const last = buckets.at(-1)
    if (last?.name === name) last.items.push(s)
    else buckets.push({ name, items: [s] })
  }
  return (
    <div>
      {buckets.map(({ name, items }, i) => (
        <section key={name} aria-label={name}>
          <h4 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b bg-card px-4 type-colhead">
            {name}
            <span className="num font-normal text-subtle">{items.length}</span>
            {i === 0 ? (
              <span className="ml-auto flex items-center gap-1.5 font-normal text-subtle">
                <span aria-hidden className="h-3 w-0.5 rounded-full bg-primary" />
                High impact
              </span>
            ) : null}
          </h4>
          {items.map((s) => (
            <WireRow key={s.key} story={s} fresh={fresh.has(s.key)} universe={universe} />
          ))}
        </section>
      ))}
    </div>
  )
}

function WireSkeleton() {
  return Array.from({ length: 8 }, (_, i) => (
    <div key={i} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 border-b px-4 py-3">
      <Skeleton className="h-4 w-10" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-[92%]" />
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
  ))
}

// --- the panel -----------------------------------------------------------------------------------

/** A small live mark beside the update time: a steady dot with one soft ring, quiet when news is down. */
function LiveMark({ live }: { live: boolean }) {
  return (
    <span className="relative flex size-2" aria-hidden>
      {live ? <span className="absolute inset-0 animate-ping rounded-full bg-up/50 [animation-duration:2.4s]" /> : null}
      <span className={cn("relative size-2 rounded-full", live ? "bg-up" : "bg-subtle")} />
    </span>
  )
}

/**
 * Market news beside the markets: the story most likely to move Indian prices, who among the
 * policy makers is speaking, the markets the day's news is about with their live moves, and the
 * wire, newest first. Every headline that names one of our markets carries its price move.
 */
export function MarketNews({ className }: { className?: string }) {
  const { stories, loading, failed, updated, fresh } = useNews()
  const { list: universe } = useUniverse()
  const [filter, setFilter] = useState<Filter>("all")
  const [market, setMarket] = useState<MarketId | null>(null)
  const now = useNow()

  const shown = useMemo(() => stories.filter((s) => matches(s, filter, market)), [stories, filter, market])
  const top = useMemo(() => {
    const recent = shown.filter((s) => now - s.at < 8 * 3600_000)
    // The story most likely to move Indian prices in the last 8 hours; more outlets, then newer, break ties.
    return [...(recent.length ? recent : shown)].sort((a, b) => b.impact - a.impact || b.sources.length - a.sources.length || b.at - a.at)[0]
  }, [shown, now])
  const wire = useMemo(() => shown.filter((s) => s !== top), [shown, top])
  const since = updated ? ago(updated, now) : null

  return (
    <Section
      flush
      title="Market news"
      count={loading ? "" : shown.length}
      className={className}
      aside={
        <>
          <span className="hidden items-center gap-2 type-meta lg:flex">
            <LiveMark live={!failed && updated !== null} />
            {failed && !stories.length ? "News is not reachable right now" : since ? (since === "now" ? "Updated just now" : `Updated ${since} ago`) : "Loading"}
          </span>
          {/* On a phone the pills scroll sideways inside the strip instead of running off it. */}
          <div className="no-scrollbar min-w-0 overflow-x-auto">
            <Segmented value={filter} onChange={setFilter} label="News filter" items={FILTERS} />
          </div>
        </>
      }
    >
      <div className="plate grid xl:h-[min(680px,calc(100dvh-220px))] xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-h-0 flex-col border-b xl:overflow-y-auto xl:border-r xl:border-b-0">
          {loading ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-[180px] w-full rounded-lg" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-6 w-[90%]" />
              <Skeleton className="h-4 w-[70%]" />
            </div>
          ) : top ? (
            <Lead story={top} universe={universe} now={now} />
          ) : null}
          {loading ? null : <WhosSpeaking stories={wire} now={now} />}
          {loading ? null : <InTheNews stories={stories.filter((s) => matches(s, filter, null))} market={market} onMarket={setMarket} universe={universe} />}
        </div>
        <div className="min-h-0 max-h-[560px] overflow-y-auto bg-card xl:max-h-none">
          {loading ? (
            <WireSkeleton />
          ) : wire.length ? (
            <Wire stories={wire.slice(0, WIRE_ROWS)} fresh={fresh} universe={universe} now={now} />
          ) : (
            <p className="px-4 py-10 text-center type-meta">
              {failed ? "News is not reachable right now. It will load again in a few minutes." : market ? `No other stories on ${MARKET_NAME[market]} today.` : "No stories in this view yet."}
            </p>
          )}
        </div>
      </div>
    </Section>
  )
}
