import { useMemo } from "react"

import { Move } from "@/components/app/move"
import { useQuote } from "@/lib/use-hub"
import { useNow } from "@/lib/use-now"
import { useTickFlash } from "@/lib/use-tick-flash"
import { cn } from "@/lib/utils"

/**
 * The world's markets an Indian trader watches before and after the open, on their own exchanges'
 * clocks. Sessions are local minutes after midnight, Monday to Friday; one past 1440 runs on past
 * midnight. Exchange holidays are not modelled.
 */
interface Venue {
  index: string
  place: string
  tz: string
  sessions: readonly (readonly [number, number])[]
  /** The hub's name for its price (`quote:global:<name>`, served from Upstox). */
  quote: string
  /** How often Upstox refreshes it, seconds (its instrument file's latency). */
  every: number
}

const VENUES: readonly Venue[] = [
  {
    index: "GIFT Nifty",
    place: "GIFT City",
    tz: "Asia/Kolkata",
    quote: "giftnifty",
    every: 120,
    sessions: [
      [390, 940],
      [995, 1605],
    ],
  },
  {
    index: "Nikkei 225",
    place: "Tokyo",
    tz: "Asia/Tokyo",
    quote: "nikkei",
    every: 900,
    sessions: [
      [540, 690],
      [750, 930],
    ],
  },
  {
    index: "Hang Seng",
    place: "Hong Kong",
    tz: "Asia/Hong_Kong",
    quote: "hsi",
    every: 900,
    sessions: [
      [570, 720],
      [780, 960],
    ],
  },
  {
    index: "DAX",
    place: "Frankfurt",
    tz: "Europe/Berlin",
    quote: "dax",
    every: 900,
    sessions: [[540, 1050]],
  },
  {
    index: "FTSE 100",
    place: "London",
    tz: "Europe/London",
    quote: "ftse",
    every: 900,
    sessions: [[480, 990]],
  },
  {
    index: "Dow Jones",
    place: "New York",
    tz: "America/New_York",
    quote: "dji",
    every: 20,
    sessions: [[570, 960]],
  },
  {
    index: "US Tech 100",
    place: "New York",
    tz: "America/New_York",
    quote: "nasdaq100",
    every: 20,
    sessions: [[570, 960]],
  },
  {
    index: "S&P 500",
    place: "New York",
    tz: "America/New_York",
    quote: "spx",
    every: 20,
    sessions: [[570, 960]],
  },
]

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const formats = new Map<string, Intl.DateTimeFormat>()

function partsIn(tz: string, ms: number) {
  let f = formats.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
    formats.set(tz, f)
  }
  const parts = f.formatToParts(ms)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  const day = WEEKDAY.indexOf(get("weekday"))
  const minutes = Number(get("hour")) * 60 + Number(get("minute"))
  // The zone's offset from UTC at this instant, in minutes, from its own wall clock.
  const wall = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute"))
  )
  const offset = Math.round((wall - Math.floor(ms / 60_000) * 60_000) / 60_000)
  return { day, minutes, offset }
}

type State = "open" | "break" | "closed"

function stateAt(v: Venue, ms: number): State {
  const { day, minutes } = partsIn(v.tz, ms)
  const weekday = day >= 1 && day <= 5
  const yesterdayWeekday = day >= 2 && day <= 6
  const open = v.sessions.some(
    ([s, e]) =>
      (weekday && minutes >= s && minutes < e) ||
      (e > 1440 && yesterdayWeekday && minutes < e - 1440)
  )
  if (open) return "open"
  const first = v.sessions[0]![0]
  const last = v.sessions[v.sessions.length - 1]![1]
  return weekday && minutes >= first && minutes < last ? "break" : "closed"
}

/** The next instant the venue changes state: a 15-minute scan, then the minute inside the step. */
function nextChange(v: Venue, ms: number): number | null {
  const now = stateAt(v, ms)
  const base = Math.floor(ms / 60_000) * 60_000
  for (let step = 1; step <= 4 * 96; step++) {
    const at = base + step * 15 * 60_000
    if (stateAt(v, at) !== now) {
      for (let m = at - 14 * 60_000; m <= at; m += 60_000)
        if (stateAt(v, m) !== now) return m
      return at
    }
  }
  return null
}

const clock = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

const span = (ms: number) => {
  const mins = Math.max(1, Math.round(ms / 60_000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return d
    ? `${d}d ${h}h`
    : h
      ? `${h}h ${String(m).padStart(2, "0")}m`
      : `${m}m`
}

const STATE: Record<State, { label: string; ink: string }> = {
  open: { label: "Open", ink: "text-up" },
  break: { label: "Lunch break", ink: "text-muted-foreground" },
  closed: { label: "Closed", ink: "text-subtle" },
}

interface VenueInfo {
  v: Venue
  local: string
  hours: string
  state: State
  next: string
  /** The sessions on the IST clock, as [start, length] in minutes after IST midnight, split at midnight. */
  bands: [number, number][]
}

function venueInfo(v: Venue, ms: number): VenueInfo {
  const { minutes, offset } = partsIn(v.tz, ms)
  const ist = partsIn("Asia/Kolkata", ms).offset
  const toIst = (local: number) =>
    (((local - offset + ist) % 1440) + 1440) % 1440
  const state = stateAt(v, ms)
  const next = nextChange(v, ms)
  const bands: [number, number][] = []
  for (const [s, e] of v.sessions) {
    const start = toIst(s)
    const len = e - s
    if (start + len <= 1440) bands.push([start, len])
    else bands.push([start, 1440 - start], [0, start + len - 1440])
  }
  return {
    v,
    local: clock(minutes),
    hours: `${clock(toIst(v.sessions[0]![0]))} to ${clock(toIst(v.sessions[v.sessions.length - 1]![1]))} IST`,
    state,
    next:
      next === null
        ? ""
        : `${state === "open" ? "Closes" : "Opens"} in ${span(next - ms)}`,
    bands,
  }
}

const pct = (m: number) => `${(m / 1440) * 100}%`

/** Every market's trading hours on one IST day, with a line at now: who trades while India sleeps, and who overlaps the Indian session. */
function SessionTimeline({
  infos,
  istNow,
}: {
  infos: VenueInfo[]
  istNow: number
}) {
  const open = infos.filter((i) => i.state === "open").length
  return (
    <div className="flex flex-col gap-4 border-b px-4 pt-4 pb-4">
      <div className="flex flex-col gap-1">
        <span data-card-title className="text-[14px]">Global sessions</span>
        <div className="flex min-h-8 items-baseline gap-3">
          <span className="num type-display">
            {open} <span className="text-subtle">of {infos.length}</span>
          </span>
          <span className="text-[14px] text-muted-foreground">open now</span>
        </div>
      </div>

      <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3">
        <div className="flex flex-col">
          {infos.map((i) => (
            <span
              key={i.v.index}
              className={cn(
                "truncate text-xs leading-6",
                i.state === "open" ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {i.v.index}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="relative">
            {infos.map((i) => (
              <div key={i.v.index} className="relative h-6">
                <div className="absolute inset-x-0 top-1/2 border-t border-border/70" />
                {i.bands.map(([start, len]) => (
                  <div
                    key={start}
                    className={cn(
                      "absolute top-1.5 h-3 rounded-[3px]",
                      i.state === "open" ? "bg-up/70" : "bg-muted-foreground/35"
                    )}
                    style={{ left: pct(start), width: pct(len) }}
                  />
                ))}
              </div>
            ))}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 border-l border-foreground/80"
              style={{ left: pct(istNow) }}
              title="Now"
            />
          </div>
          <div className="relative mt-1 h-4">
            {[0, 6, 12, 18, 24].map((h) => (
              <span
                key={h}
                className={cn(
                  "absolute w-8 num text-[11px] leading-4 text-subtle",
                  h === 0
                    ? "text-left"
                    : h === 24
                      ? "text-right"
                      : "-ml-4 text-center"
                )}
                style={h === 24 ? { right: 0 } : { left: pct(h * 60) }}
              >
                {String(h % 24).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const every = (sec: number) => (sec >= 60 ? `${sec / 60} min` : `${sec} s`)

/** A price from Upstox with its change on yesterday's close, or a quiet dash until one arrives. */
function GlobalPrice({ name, digits = 2 }: { name: string; digits?: number }) {
  const quote = useQuote(`global:${name}`)
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)
  const change = quote?.pc ? quote.ltp - quote.pc : null
  return (
    <span className="flex flex-col items-end">
      <span
        ref={flash}
        className={cn(
          "rounded-sm num text-[13px]",
          quote ? "text-foreground" : "text-subtle"
        )}
      >
        {quote
          ? quote.ltp.toLocaleString("en-IN", {
              minimumFractionDigits: digits,
              maximumFractionDigits: digits,
            })
          : "-"}
      </span>
      {change !== null && quote?.pc ? (
        <Move
          change={change}
          pct={(change / quote.pc) * 100}
          className="text-xs"
        />
      ) : (
        <span className="h-4" />
      )}
    </span>
  )
}

function VenueRow({ info }: { info: VenueInfo }) {
  return (
    <div
      className="grid h-[52px] grid-cols-[minmax(0,1fr)_minmax(88px,auto)_minmax(96px,auto)] items-center gap-3 border-b px-4 last:border-b-0"
      title={`${info.v.index} trades ${info.hours}. Price updates every ${every(info.v.every)}. Exchange holidays are not shown.`}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] text-soft">{info.v.index}</span>
        <span className="truncate num type-meta">
          {info.v.place} {info.local}
        </span>
      </span>
      <GlobalPrice name={info.v.quote} />
      <span className="flex flex-col items-end">
        <span className={cn("text-xs", STATE[info.state].ink)}>
          {STATE[info.state].label}
        </span>
        <span className="num type-meta">{info.next}</span>
      </span>
    </div>
  )
}

/** The rupee and crude, which move the Indian open as much as any index. */
const CUES = [
  { name: "usdinr", label: "USD INR", digits: 4 },
  { name: "brent", label: "Brent", digits: 2 },
  { name: "wti", label: "WTI", digits: 2 },
] as const

function Cues() {
  return (
    <div className="grid grid-cols-3 gap-px border-t bg-border">
      {CUES.map((c) => (
        <div
          key={c.name}
          className="flex min-w-0 items-start justify-between gap-2 bg-card px-4 py-3"
          title={`${c.label}, updates every 20 s`}
        >
          <span className="truncate pt-px type-meta">{c.label}</span>
          <GlobalPrice name={c.name} digits={c.digits} />
        </div>
      ))}
    </div>
  )
}

/**
 * The world's markets as an overview panel like its neighbours: the day's trading hours on one IST
 * timeline on top, each market listed under it with its price (from Upstox through the hub), local time and
 * state, and the rupee and crude at the foot. Recomputed once a minute.
 */
export function WorldMarkets() {
  const minute = Math.floor(useNow() / 60_000)
  const { infos, istNow } = useMemo(() => {
    const ms = minute * 60_000
    return {
      infos: VENUES.map((v) => venueInfo(v, ms)),
      istNow: partsIn("Asia/Kolkata", ms).minutes,
    }
  }, [minute])

  return (
    <div className="flex h-full flex-col bg-card">
      <SessionTimeline infos={infos} istNow={istNow} />
      <div className="panel-head grid h-8 grid-cols-[minmax(0,1fr)_minmax(88px,auto)_minmax(96px,auto)] items-center gap-3 bg-card px-4 type-colhead">
        <span>Market</span>
        <span className="text-right">Price</span>
        <span className="text-right">Status</span>
      </div>
      <div className="flex-1">
        {infos.map((i) => (
          <VenueRow key={i.v.index} info={i} />
        ))}
      </div>
      <Cues />
    </div>
  )
}
