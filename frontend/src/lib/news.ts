import { useEffect, useState } from "react"

/**
 * Market news. The hub passes a fixed list of public RSS feeds through `/news` (hub/src/news.rs);
 * this module reads them in the browser, drops what is older than a day and a half, groups the
 * same event told by several outlets into one story, and tags each story with the topics and the
 * markets on this site it is about, so the page can put a live price next to a headline.
 */

export type NewsTopic = "Policy" | "Indices" | "Stocks" | "Commodities" | "Economy" | "Global"
export type NewsRegion = "India" | "Global"
/** What a feed covers: market reports, Indian policy, the global economy, world events, or an official body's own releases. */
export type FeedKind = "markets" | "policy" | "macro" | "global" | "official"

export interface NewsFeed {
  id: string
  name: string
  region: NewsRegion
  kind?: FeedKind
}

export interface Article {
  /** The article's address; also its identity. */
  link: string
  title: string
  summary: string
  /** Publisher, e.g. "Mint" or "Reuters". */
  source: string
  region: NewsRegion
  kind: FeedKind
  /** Publication time, ms since the epoch. */
  at: number
  image: string | null
}

export interface Story {
  key: string
  /** The article the story is shown by: the one with the most to say. */
  lead: Article
  /** Every outlet's article on it, newest first. */
  articles: Article[]
  /** Distinct publishers, in the order they reported it. */
  sources: string[]
  /** The latest report's time. */
  at: number
  topics: NewsTopic[]
  /** Markets on this site the story is about (ids the Markets page quotes). */
  markets: MarketId[]
  region: NewsRegion
  /** How much this can move Indian markets (see `impactOf`); stories under IMPACT_FLOOR are left out. */
  impact: number
  level: "high" | "medium" | null
  /** Who is speaking or acting, when it is someone markets listen to: "Finance Minister", "RBI", "Fed". */
  actor: string | null
}

// --- markets a headline can name ----------------------------------------------------------------

export type MarketId =
  | "nse:nifty"
  | "nse:banknifty"
  | "bse:sensex"
  | "nse:finnifty"
  | "nse:midcpnifty"
  | "nse:indiavix"
  | "mcx:crudeoil"
  | "mcx:gold"
  | "mcx:silver"
  | "mcx:naturalgas"
  | "mcx:copper"
  | "global:usdinr"
  | "global:spx"
  | "global:nasdaq100"
  | "global:dji"
  | "global:nikkei"
  | "global:hsi"
  | "global:giftnifty"

/** What each market is called in a headline. Order matters only for reading; every match is kept. */
const MARKET_WORDS: readonly [MarketId, RegExp][] = [
  ["nse:banknifty", /\b(bank\s?nifty|nifty\s?bank)\b/i],
  ["nse:finnifty", /\b(fin\s?nifty|nifty\s?financial)\b/i],
  ["nse:midcpnifty", /\b(midcap|mid-cap)\b/i],
  ["global:giftnifty", /\bgift\s?nifty\b/i],
  // Nifty on its own: not Bank Nifty, Fin Nifty, Gift Nifty or a sector index.
  ["nse:nifty", /(?<!(bank|fin|gift)\s?)\bnifty\b(?!\s?(bank|financial|it|auto|pharma|metal|fmcg|realty|midcap|smallcap|next|media|psu|energy))/i],
  ["bse:sensex", /\bsensex\b/i],
  ["nse:indiavix", /\bindia\s?vix\b/i],
  ["mcx:crudeoil", /\b(crude|brent|wti|oil prices?|opec)\b/i],
  ["mcx:gold", /\bgold\b/i],
  ["mcx:silver", /\bsilver\b/i],
  ["mcx:naturalgas", /\bnatural\s?gas\b/i],
  ["mcx:copper", /\bcopper\b/i],
  ["global:usdinr", /\b(rupee|usd\s?\/?\s?inr|dollar index)\b/i],
  ["global:spx", /\b(s&p\s?500|s&p)\b/i],
  ["global:nasdaq100", /\bnasdaq\b/i],
  ["global:dji", /\b(dow jones|the dow|dow)\b/i],
  ["global:nikkei", /\bnikkei\b/i],
  ["global:hsi", /\bhang seng\b/i],
]

/** Indian policy makers and what they decide: what a desk stops to read. */
const POLICY = /\b(finance minister|finance ministry|sitharaman|union budget|budget 20\d\d|rbi|reserve bank|monetary policy|mpc|repo rate|crr|slr|sebi|gst council|gst|cbdt|income tax|capital gains tax|stt|cabinet (approves|clears)|government|centre|ministry of|niti aayog|pmo|modi)\b/i

const TOPIC_WORDS: readonly [NewsTopic, RegExp][] = [
  ["Policy", POLICY],
  ["Indices", /\b(nifty|sensex|bankex|index|indices|benchmark|d-street|dalal street|market (opens?|closes?|ends?|wrap))\b/i],
  ["Commodities", /\b(crude|brent|wti|oil|opec|gold|silver|copper|zinc|aluminium|natural gas|lng|commodit\w*|mcx)\b/i],
  ["Economy", /\b(rbi|repo|inflation|cpi|wpi|gdp|fiscal|budget|fed|federal reserve|ecb|boe|interest rates?|rate (cut|hike)s?|bond yields?|treasur\w+|tariffs?|rupee|forex|fpis?|fiis?|dii|recession|jobs|payrolls|pmi|economy|economic)\b/i],
  ["Stocks", /\b(shares?|stocks?|ipo|q[1-4]|results|earnings|profit|revenue|dividend|buyback|target price|block deal|stake|order win|listing|brokerages?|upgrade|downgrade)\b/i],
  ["Global", /\b(wall street|s&p|nasdaq|dow jones|nikkei|hang seng|ftse|dax|china|japan|europe\w*|trump|treasury|global|world)\b/i],
]
// --- how much a story matters to an Indian market desk -------------------------------------------

/**
 * Who is speaking or acting, first match wins. Shown before a headline, because the speaker is
 * often the whole story: "Finance Minister" saying it moves the market, a columnist saying it does not.
 */
const ACTORS: readonly [string, RegExp][] = [
  // Any country has one; India's is named, or the story says it is India's (see INDIA_CONTEXT).
  ["Finance Minister", /\b(sitharaman|finance minister|finance ministry|fm says|fm to)\b/i],
  ["RBI", /\b(rbi|reserve bank|rbi governor|malhotra|monetary policy committee|mpc)\b/i],
  ["SEBI", /\bsebi\b/i],
  ["GST Council", /\bgst council\b/i],
  ["Govt", /\b(union cabinet|cabinet (approves|clears)|pm modi|prime minister modi|government of india|centre to|niti aayog)\b/i],
  ["Fed", /\b(federal reserve|fomc|fed chair|fed governor|fed officials?|fed minutes|fed rate|fed policy|fed's|powell (said|says|signals|warns|speech))\b/i],
  ["OPEC", /\bopec\+?\b/i],
  ["White House", /\b(trump|white house)\b/i],
  ["ECB", /\b(ecb|european central bank|lagarde)\b/i],
  ["China", /\b(pboc|people's bank of china|beijing|xi jinping)\b/i],
]

/** A story is about India: named, or told by an Indian newsroom. Indian policy words count only then. */
const INDIA_CONTEXT = /\b(india|indian|sitharaman|new delhi|union budget|centre|rbi|sebi|nifty|sensex|rupee|gst)\b/i
const INDIAN_OUTLETS = /^(et|et markets|mint|business standard|the economic times|economic times|moneycontrol|financial express|the financial express|business today|the hindu businessline|businessline|ndtv profit|ndtv|hindustan times|the hindu|times of india|the times of india|indian express|the indian express|india today|zee business|cnbc ?tv18|rbi)$/i
const INDIAN_ACTORS_SET = new Set(["Finance Minister", "RBI", "SEBI", "GST Council", "Govt"])

/** What a story is about, weighted by how directly it moves Indian prices. Each that matches adds its weight once. */
const WEIGHTS: readonly [number, RegExp, ("india" | undefined)?][] = [
  // Indian policy makers and their decisions: only when the story is about India.
  [5, /\b(finance minister|sitharaman|rbi|reserve bank|sebi|gst council|union budget|monetary policy|repo rate|rate (cut|hike))\b/i, "india"],
  [3, /\b(government|cabinet|centre|ministry|tax|gst|stt|capital gains|disinvestment|fiscal deficit|borrowing)\b/i, "india"],
  // The numbers the market trades on.
  [4, /\b(inflation|cpi|wpi|gdp|iip|pmi|current account|trade deficit|forex reserves|liquidity|bond yields?|10-year|g-sec)\b/i],
  [4, /\b(fpis?|fiis?|diis?|foreign (portfolio )?investors|outflows?|inflows?)\b/i],
  [4, /\b(rupee|usd\/?inr|dollar index)\b/i],
  // Abroad, what reaches Indian prices.
  [4, /\b(federal reserve|fed|powell|fomc|treasury yields?|ecb|bank of japan|boj|pboc)\b/i],
  [4, /\b(crude|brent|oil prices?|opec)\b/i],
  [3, /\b(tariffs?|trade (deal|war|talks)|sanctions|export curbs?)\b/i],
  [3, /\b(war|ceasefire|strikes? on|missile|iran|israel|russia|ukraine|middle east|red sea|strait of hormuz)\b/i],
  [2, /\b(recession|slowdown|stimulus|default|crisis|sell-?off|crash|rally|record high)\b/i],
  // Ties it to India.
  [3, /\b(india|indian|nifty|sensex|dalal street|d-street|bse|nse|mcx)\b/i],
  [1, /\b(markets?|stocks|shares|equities|index|futures)\b/i],
]

/** Stories below this say nothing a market desk needs (a phone plan, a golf league): left out. */
export const IMPACT_FLOOR = 4
const HIGH = 12
const MEDIUM = 8

function impactOf(text: string, kind: FeedKind, sources: number, markets: number, indian: boolean): number {
  let score = WEIGHTS.reduce((sum, [w, re, needs]) => sum + ((needs !== "india" || indian) && re.test(text) ? w : 0), 0)
  if (kind === "official") score += 6
  else if (kind === "policy") score += 2
  else if (kind === "markets") score += 1
  score += Math.min(4, (sources - 1) * 2)
  score += Math.min(3, markets)
  return score
}

/** "US" and "U.S." only in capitals: "us" is a pronoun. */
const US = /\b(US|U\.S\.?|USA)\b/

// --- reading a feed ----------------------------------------------------------------------------

const textOf = (el: Element | null | undefined): string => el?.textContent?.trim() ?? ""

const ENTITY = document.createElement("textarea")
/** Decodes entities and drops tags: descriptions often carry HTML, sometimes encoded twice. */
function plain(raw: string): string {
  let s = raw
  for (let i = 0; i < 2 && s.includes("&"); i++) {
    ENTITY.innerHTML = s
    s = ENTITY.value
  }
  return s.replace(/<[^>]*>?/g, " ").replace(/\s+/g, " ").trim()
}

function imageOf(item: Element): string | null {
  for (const el of Array.from(item.getElementsByTagName("*"))) {
    const name = el.localName
    if ((name === "content" || name === "thumbnail") && el.getAttribute("url")) return el.getAttribute("url")
    if (name === "enclosure" && /^image\//.test(el.getAttribute("type") ?? "image/")) {
      const url = el.getAttribute("url")
      if (url) return url
    }
  }
  return null
}

const ROUTINE_RBI =
  /\b(auction|money market operations|treasury bills?|t-bills?|reserve money|sectoral deployment|weekly statistical|imposes (monetary )?penalty|monetary penalty|cancels? (the )?certificate|certificate of registration|lending and deposit rates|directions under section|all inclusive directions|state government securities|sdl|ways and means|liquidity adjustment facility|underwriting auction)\b/i

/** Newsrooms kept from search feeds (Google News), by the publisher name it gives. */
const TRUSTED =
  /^(reuters|bloomberg|cnbc|cnbc ?tv18|the economic times|economic times|et now|mint|livemint|business standard|moneycontrol|financial express|the financial express|business today|the hindu businessline|businessline|ndtv profit|ndtv|hindustan times|the hindu|times of india|the times of india|indian express|the indian express|india today|zee business|financial times|the wall street journal|wsj|marketwatch|barron's|yahoo finance|forbes|fortune|the associated press|ap news|associated press|bbc|cnn|al jazeera|nikkei asia|south china morning post|the guardian|the new york times|axios|politico|investing\.com|kitco|oilprice|s&p global|fxstreet|the straits times|press information bureau|pib)/i

/** One feed's items. Google News titles end in " - Publisher"; that publisher is the source. */
function parseFeed(xml: string, feed: NewsFeed): Article[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml")
  if (doc.getElementsByTagName("parsererror").length) return []
  const now = Date.now()
  return Array.from(doc.getElementsByTagName("item")).flatMap((item): Article[] => {
    let title = plain(textOf(item.getElementsByTagName("title")[0]))
    const link = textOf(item.getElementsByTagName("link")[0])
    if (!title || !/^https?:\/\//.test(link)) return []
    let source = feed.name
    const publisher = textOf(item.getElementsByTagName("source")[0])
    if (publisher) {
      source = publisher
        .replace(/\.(com|co\.uk|in)$/i, "")
        .replace(/^(the )?economic times$/i, "ET")
        .replace(/^livemint$/i, "Mint")
      if (title.endsWith(` - ${publisher}`)) title = title.slice(0, -publisher.length - 3)
    }
    // A search feed brings in any site that used the words (a basketball blog's "Powell"); only
    // newsrooms a desk would trust are kept from those.
    if (feed.id.startsWith("gn-") && !TRUSTED.test(source)) return []
    // "…, Bloomberg News reports": the outlet is already named beside the story.
    title = title.replace(/,? (Bloomberg News|Bloomberg|Reuters) reports?$/i, "")
    const at = Date.parse(textOf(item.getElementsByTagName("pubDate")[0]))
    // The RBI's own feed: its daily operations (auctions, money-market figures, penalties on small
    // banks) are routine; policy, rates and regulation are what it is here for.
    if (feed.kind === "official" && ROUTINE_RBI.test(title)) return []
    let summary = plain(textOf(item.getElementsByTagName("description")[0]))
    // Google News descriptions repeat the headline as a link; nothing to read there.
    if (summary.startsWith(title.slice(0, 40))) summary = ""
    if (summary.length > 420) summary = `${summary.slice(0, 420).replace(/\s+\S*$/, "")}…`
    return [
      {
        link,
        title,
        summary,
        source,
        region: feed.region,
        kind: feed.kind ?? "markets",
        at: Number.isFinite(at) ? Math.min(at, now) : now,
        image: imageOf(item),
      },
    ]
  })
}

// --- grouping into stories ---------------------------------------------------------------------

const STOP = new Set(
  "a an and are as at be by for from has have in is it its of on or over says say said than that the this to up was were what when will with after amid into new today stock stocks share shares market markets india indian".split(
    " "
  )
)

function wordsOf(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9₹%.\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  )
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / Math.min(a.size, b.size)
}

/** Two headlines this alike, within this long of each other, are one story. */
const SAME_STORY = 0.6
const STORY_WINDOW = 12 * 3600_000
const KEEP_FOR = 30 * 3600_000

function tagsOf(text: string) {
  const topics = TOPIC_WORDS.filter(([, re]) => re.test(text)).map(([t]) => t)
  if (!topics.includes("Global") && US.test(text)) topics.push("Global")
  const markets = MARKET_WORDS.filter(([, re]) => re.test(text)).map(([m]) => m)
  return { topics, markets }
}

export function storiesOf(articles: readonly Article[], now = Date.now()): Story[] {
  const fresh = [...new Map(articles.map((a) => [a.link, a])).values()]
    .filter((a) => now - a.at < KEEP_FOR)
    .sort((a, b) => b.at - a.at)
  const groups: { words: Set<string>; items: Article[] }[] = []
  for (const a of fresh) {
    const words = wordsOf(a.title)
    const home = groups.find(
      (g) => Math.abs(g.items[0]!.at - a.at) < STORY_WINDOW && overlap(g.words, words) >= SAME_STORY
    )
    if (home) {
      home.items.push(a)
      for (const w of words) home.words.add(w)
    } else groups.push({ words, items: [a] })
  }
  return groups
    .map(({ items }): Story => {
      const lead = [...items].sort((a, b) => b.summary.length + (b.image ? 80 : 0) - (a.summary.length + (a.image ? 80 : 0)))[0]!
      // Headlines say what a story is about; a summary's passing mention should not tag it.
      const titles = items.map((i) => i.title).join(" ")
      const text = `${titles} ${lead.summary}`
      const { topics, markets } = tagsOf(text)
      const sources = [...new Set([...items].sort((a, b) => a.at - b.at).map((i) => i.source))]
      if (lead.region === "Global" && !topics.includes("Global")) topics.push("Global")
      const kind = items.some((i) => i.kind === "official") ? "official" : items.some((i) => i.kind === "policy") ? "policy" : lead.kind
      const indian = INDIA_CONTEXT.test(text) || sources.some((s) => INDIAN_OUTLETS.test(s))
      const impact = impactOf(text, kind, sources.length, markets.length, indian)
      // An Indian policy maker's label only on a story about India: Morocco's finance minister is not ours.
      // The first one the lead headline names: "SEBI aligns limits with RBI norms" is SEBI's story.
      const actor =
        ACTORS.flatMap(([name, re]) => {
          const at = lead.title.search(re)
          return at >= 0 && (indian || !INDIAN_ACTORS_SET.has(name)) ? [{ name, at }] : []
        }).sort((a, b) => a.at - b.at)[0]?.name ?? null
      if (!indian || !POLICY.test(titles)) {
        const i = topics.indexOf("Policy")
        if (i >= 0) topics.splice(i, 1)
      }
      return {
        key: lead.link,
        lead,
        articles: items,
        sources,
        at: items[0]!.at,
        topics,
        markets,
        region: items.some((i) => i.region === "India") ? "India" : "Global",
        impact,
        level: impact >= HIGH ? "high" : impact >= MEDIUM ? "medium" : null,
        actor,
      }
    })
    .filter((s) => s.impact >= IMPACT_FLOOR)
}

// --- the live list -----------------------------------------------------------------------------

const REFRESH_MS = 3 * 60_000

export interface NewsState {
  stories: Story[]
  loading: boolean
  /** Every feed failed on the last attempt. */
  failed: boolean
  updated: number | null
  /** Story keys that arrived after the first load, so the page can mark them new. */
  fresh: ReadonlySet<string>
}

let feedList: Promise<NewsFeed[]> | null = null

async function loadAll(): Promise<{ articles: Article[]; ok: number }> {
  feedList ??= fetch("/news").then((r) => {
    if (!r.ok) throw new Error("news list")
    return r.json() as Promise<NewsFeed[]>
  })
  let feeds: NewsFeed[]
  try {
    feeds = await feedList
  } catch {
    feedList = null
    return { articles: [], ok: 0 }
  }
  const parts = await Promise.allSettled(
    feeds.map(async (f) => {
      const r = await fetch(`/news?id=${encodeURIComponent(f.id)}`)
      if (!r.ok) throw new Error(f.id)
      return parseFeed(await r.text(), f)
    })
  )
  const ok = parts.filter((p) => p.status === "fulfilled").length
  return { articles: parts.flatMap((p) => (p.status === "fulfilled" ? p.value : [])), ok }
}

/** The day's market stories, refreshed every few minutes while the page is open and visible. */
export function useNews(): NewsState {
  const [state, setState] = useState<NewsState>({ stories: [], loading: true, failed: false, updated: null, fresh: new Set() })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let seen: Set<string> | null = null
    const run = async () => {
      const { articles, ok } = await loadAll()
      if (cancelled) return
      const stories = storiesOf(articles)
      const keys = new Set(stories.map((s) => s.key))
      const fresh = seen ? new Set([...keys].filter((k) => !seen!.has(k))) : new Set<string>()
      if (ok > 0) seen = new Set([...(seen ?? []), ...keys])
      setState((s) => ({
        stories: ok > 0 ? stories : s.stories,
        loading: false,
        failed: ok === 0,
        updated: ok > 0 ? Date.now() : s.updated,
        fresh: ok > 0 ? fresh : s.fresh,
      }))
      timer = setTimeout(tick, REFRESH_MS)
    }
    const tick = () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(tick, 30_000)
        return
      }
      void run()
    }
    void run()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return state
}

/** "4m", "2h", "Yesterday 18:40": how long ago, the way a wire prints it. */
export function ago(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000))
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
