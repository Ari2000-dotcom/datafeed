import { Section } from "@/components/app/section"
import { Move } from "@/components/app/move"
import { Skeleton } from "@/components/ui/skeleton"
import { dateLabel, fmt2, istParts, type Tone } from "@/lib/format"
import { FEATURED } from "@/lib/instruments"
import { sessions, type SessionState } from "@/lib/session"
import { useDay } from "@/lib/use-day"
import { useNow } from "@/lib/use-now"
import { cn } from "@/lib/utils"

const VIX_ID = "nse:indiavix"
const TRADED = FEATURED.filter((f) => f.options)

const STATE_LABEL: Record<SessionState, string> = {
  open: "Open",
  pre: "Pre-open",
  closed: "Closed",
}

/** When NSE next opens or closes, in words a visitor reads at a glance. Holidays are not modelled. */
function nseNote(state: SessionState, now: number): string {
  if (state === "open") return "Closes at 15:30 IST"
  if (state === "pre") return "Opens at 09:15 IST"
  const { weekday, minutes } = istParts(now)
  const weekend = weekday === "Sat" || weekday === "Sun"
  if (!weekend && minutes < 9 * 60) return "Opens today at 09:15 IST"
  if (weekday === "Fri" || weekend) return "Opens Monday at 09:15 IST"
  return "Opens tomorrow at 09:15 IST"
}

/** India VIX bands as traders read them. A plain description of the level, not a forecast. */
function vixRead(v: number): string {
  if (v < 12) return "Low volatility"
  if (v < 18) return "Normal volatility"
  if (v < 25) return "Elevated volatility"
  return "High volatility"
}

/** NSE's session as a share of its 375 minutes, 0 before the open and 1 after the close. */
function sessionShare(state: SessionState, now: number): number {
  if (state !== "open")
    return state === "pre" ? 0 : istParts(now).minutes >= 15 * 60 + 30 ? 1 : 0
  return Math.min(1, Math.max(0, (istParts(now).minutes - (9 * 60 + 15)) / 375))
}

/** A 6px rule with no filled track behind it: the cells' one shape, so the three read as a set. */
function Rule({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className="relative flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted"
    >
      {children}
    </div>
  )
}

/** Every cell has the same four lines: what it is, the figure, a rule that shows it, and a plain note. */
function Cell({
  label,
  children,
  rule,
  note,
}: {
  label: string
  children: React.ReactNode
  rule: React.ReactNode
  note?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-card px-5 pt-4 pb-3.5">
      <span className="type-label">{label}</span>
      <div className="flex min-h-7 items-baseline gap-2.5">{children}</div>
      <div className="mt-1">{rule}</div>
      <span className="truncate type-meta">{note}</span>
    </div>
  )
}

/**
 * The page's opening read: is the market open, how broad is the move, how nervous is it, and which way
 * it is moving. Every figure is live; nothing here is a forecast.
 */
export function MarketPulse({ tones }: { tones: Record<string, Tone | null> }) {
  const now = useNow()
  const nse = sessions(now).find((s) => s.exchange === "NSE")!.state
  const mcx = sessions(now).find((s) => s.exchange === "MCX")!.state
  const vix = useDay(VIX_ID)

  const up = TRADED.filter((f) => tones[f.id] === "up").length
  const down = TRADED.filter((f) => tones[f.id] === "down").length
  const known = TRADED.filter((f) => tones[f.id] != null).length

  return (
    <Section
      flush
      title="Today"
      aside={<span className="type-meta">{`${istParts(now).weekday}, ${dateLabel(new Date(now + 330 * 60_000).toISOString().slice(0, 10))}`}</span>}
    >
    <div className="plate grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
      <Cell
        label="Market status"
        note={nseNote(nse, now)}
        rule={
          <Rule
            label={`NSE session ${Math.round(sessionShare(nse, now) * 100)}% done`}
          >
            <span
              className={cn(
                "rounded-full",
                nse === "open" ? "bg-up" : "bg-muted-foreground/50"
              )}
              style={{ width: `${sessionShare(nse, now) * 100}%` }}
            />
          </Rule>
        }
      >
        <span
          className={cn(
            "type-figure-lg",
            nse === "open" ? "text-up" : "text-foreground"
          )}
        >
          NSE {STATE_LABEL[nse]}
        </span>
        <span className="text-[13px] text-muted-foreground">
          MCX {STATE_LABEL[mcx]}
        </span>
      </Cell>

      <Cell
        label="Indices up and down"
        rule={
          <Rule label={`${up} up, ${down} down`}>
            {up ? <span className="bg-up" style={{ flexGrow: up }} /> : null}
            {known - up - down ? (
              <span
                className="bg-muted-foreground/50"
                style={{ flexGrow: known - up - down }}
              />
            ) : null}
            {down ? (
              <span className="bg-down" style={{ flexGrow: down }} />
            ) : null}
          </Rule>
        }
        note={
          known
            ? `Across the ${TRADED.length} main indices`
            : "Prices are on their way"
        }
      >
        {known ? (
          <>
            <span className="num type-figure-lg">
              <span className="text-up">{up}</span>
              <span className="text-subtle"> / </span>
              <span className="text-down">{down}</span>
            </span>
            <span className="text-[13px] text-muted-foreground">up / down</span>
          </>
        ) : (
          <Skeleton className="h-6 w-28" />
        )}
      </Cell>

      <Cell
        label="India VIX"
        rule={
          <Rule
            label={
              vix.quote
                ? `India VIX ${fmt2(vix.quote.ltp)} on a 10 to 30 scale`
                : "India VIX is on its way"
            }
          >
            {vix.quote ? (
              <span
                className="absolute top-0 -ml-0.5 h-1.5 w-1 rounded-full bg-foreground"
                style={{
                  left: `${Math.min(100, Math.max(0, ((vix.quote.ltp - 10) / 20) * 100))}%`,
                }}
              />
            ) : null}
          </Rule>
        }
        note={
          vix.quote
            ? `${vixRead(vix.quote.ltp)} on a 10 to 30 scale`
            : "The market's expected volatility"
        }
      >
        {vix.quote ? (
          <>
            <span className="num type-figure-lg">{fmt2(vix.quote.ltp)}</span>
            {vix.change !== null ? (
              <Move change={vix.change} pct={vix.pct} className="text-[13px]" />
            ) : null}
          </>
        ) : (
          <Skeleton className="h-6 w-20" />
        )}
      </Cell>
    </div>
    </Section>
  )
}
