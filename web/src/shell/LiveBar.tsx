import { useEffect, useRef, useState, type ReactNode } from "react";

import { fmt0, fmt2 } from "../core/format";
import { useSummaries, type Summary } from "../desk/summary";
import { daysTo, shortDate, useFollowedPick } from "../option/PickStrip";
import { lineOf, type LineId } from "../straddle/StraddleChart";
import { useFitRow } from "../ui/fitRow";
import "./livebar.css";

/**
 * The Desk's line of live figures: what the ATM straddle is worth right now, and the figures a
 * straddle desk reads it against — all on one line, the height of the Terminal's own toolbar, so
 * the board below keeps the screen.
 *
 * It reads in three groups, set off by a hairline each and nothing else: what the board is on
 * (the underlying, its exchange, the expiry and the money strike), what it is worth (the one
 * number the page is about, and its move since the open), and what that is read against (the
 * average, the synthetic future, the spot, the two legs, the vol). The gaps say the grouping — a
 * word-space inside a pair, a column between two pairs, a rule between two groups — so the line
 * is scanned rather than read token by token.
 *
 * Hierarchy is size and ink, never weight: the underlying's name is the one thing here in the
 * heavier face, and every figure on the line, the straddle's price included, is set regular.
 * Weight on a number is what makes a board look home-made, and the type tokens say as much.
 *
 * Colour is read off the chart below, not invented here (user, 2026-11-02). A figure that is a
 * line on that chart is written in that line's colour — the synthetic future in its blue, VWAP in
 * its yellow, spot in its grey, the vol in its amber, India VIX in its teal — taken from the
 * chart's own table (`straddle/StraddleChart` `LINES`), so the bar and the status line under it
 * can never drift apart. The two legs are not drawn on the chart, so they stay in the reading ink,
 * and the straddle's own price stays there too: it is the headline, and a headline takes the
 * strongest ink rather than a hue. The up and down pair is left to the moves, which is the only
 * place on this line where a colour means a direction.
 *
 * A move is bracketed, as the chart's legend brackets it: `(−0.98%)` against the price it belongs
 * to, `(−24.35)` under VWAP, `(−2.36 pts)` under the vol, the brackets themselves in the quietest
 * ink so the figure inside them carries.
 *
 * The straddle's price flashes green or red as each minute arrives — the tick flash a dealing
 * screen has, which says a figure moved without the reader watching for it.
 *
 * It adds no topics of its own: the straddle chart below already holds the hub's straddle topic,
 * and what it receives is published to `desk/summary`, which this reads. So the bar is the latest
 * minute, always, where the chart's own legend follows the crosshair — point at 11:40 on the chart
 * and the legend says 11:40 while this still says now.
 *
 * As the bar narrows, pieces give way by rank rather than being cut (`ui/fitRow.ts`), least
 * telling first: India VIX, the legs, the vol, the synthetic future, the spot, what the straddle
 * is worth against its average, the expiry, the money strike, the exchange, and last VWAP with the
 * rule that opens its group. What is left on the narrowest screen is the underlying, its price,
 * and whether that price is live — which is the least a board can say and still be a board.
 */

/** What gives way as the bar narrows, least telling first (`ui/fitRow.ts` hides the lowest rank first). */
const DROP = {
  vix: 1,
  legs: 2,
  iv: 3,
  synth: 4,
  spot: 5,
  vsVwap: 6,
  expiry: 7,
  atm: 8,
  exchange: 9,
  vwap: 10,
  /* The last two rungs, for a bar too narrow even for the floor: the day a shut market closed on
     (the dot and "Closed" still say it), then the straddle's move as a percent (the points still
     say it). Past these the line has nothing left to give. */
  closedDay: 11,
  changePct: 12,
} as const;

/** How long a figure's flash lasts: long enough to catch at the edge of vision, short enough not to lag the next minute. */
const FLASH_MS = 420;

type Tick = "up" | "down" | null;

/**
 * Which way `value` last moved, for `FLASH_MS` after it moved. Null at rest, and for the first
 * reading: arriving is not a move.
 */
function useTick(value: number | null | undefined): Tick {
  const previous = useRef<number | null>(null);
  const [tick, setTick] = useState<Tick>(null);
  useEffect(() => {
    if (value === null || value === undefined) return;
    const was = previous.current;
    previous.current = value;
    if (was === null || value === was) return;
    setTick(value > was ? "up" : "down");
    const timer = window.setTimeout(() => setTick(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  return tick;
}

const toneOf = (v: number | null) => (v === null ? "" : v > 0 ? "mh-up" : v < 0 ? "mh-down" : "");
const signed = (v: number, places: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(places)}`;

/**
 * A move since the open, bracketed and in its direction's colour, the way the chart's legend
 * writes one. Anything inside the brackets is the figure; the brackets themselves are the
 * quietest ink (livebar.css), so they frame without competing.
 */
function Move({ of, places, unit, drop }: Readonly<{ of: number | null; places: number; unit?: string; drop?: number }>) {
  if (of === null) return null;
  return (
    <span className={`mh-livebar-move ${toneOf(of)}`} data-drop={drop}>
      <em>
        {signed(of, places)}
        {unit ? ` ${unit}` : ""}
      </em>
    </span>
  );
}

/** One figure: its label in the quiet ink, its value in its chart line's colour, then its move. */
function Figure({
  label,
  title,
  value,
  line,
  move,
  drop,
}: Readonly<{
  label: string;
  title: string;
  value: number | string | null;
  /** The chart line this figure is: its value is written in that line's colour. The legs, which
   *  are not drawn on the chart, have none and stay in the reading ink. */
  line?: LineId;
  /** Said after the value in its own colour; omitted where the figure has no move to show. */
  move?: ReactNode;
  /** The rank at which it gives way on a narrow bar (ui/fitRow.ts); the lowest goes first. */
  drop: number;
}>) {
  const flash = useTick(typeof value === "number" ? value : null);
  return (
    <span className="mh-livebar-figure" data-drop={drop} title={title}>
      <span className="mh-livebar-label">{label}</span>
      <span className="mh-livebar-value" data-tick={flash ?? undefined} style={line ? { color: `var(${lineOf(line).colour})` } : undefined}>
        {value === null ? "—" : typeof value === "number" ? fmt2(value) : value}
      </span>
      {move}
    </span>
  );
}

export function LiveBar() {
  const [pick] = useFollowedPick();
  const rows = useSummaries();
  const summary = pick ? rows.find((r) => r.key === `${pick.underlying.id}|${pick.expiry}`) : undefined;

  if (!pick) {
    return (
      <header className="mh-livebar">
        <div className="mh-livebar-row">
          <span className="mh-livebar-quiet">Pick an underlying on the straddle chart below.</span>
        </div>
      </header>
    );
  }
  if (!summary) {
    return (
      <header className="mh-livebar">
        <div className="mh-livebar-row">
          <span className="mh-livebar-id">
            <span className="mh-livebar-name">{pick.underlying.name}</span>
            <span className="mh-livebar-ex">{pick.underlying.id.split(":")[0]!.toUpperCase()}</span>
          </span>
          <span className="mh-livebar-rule" aria-hidden />
          <span className="mh-livebar-quiet">Waiting for the first minute of the session.</span>
        </div>
      </header>
    );
  }
  return <Board summary={summary} />;
}

/** The bar with a session to show. */
function Board({ summary }: Readonly<{ summary: Summary }>) {
  const { last, open, closedOn } = summary;
  const fit = useFitRow();
  const flash = useTick(last.straddle);
  const change = last.straddle - open.straddle;
  const changePct = open.straddle === 0 ? null : (change / open.straddle) * 100;
  const ivMove = last.iv !== null && open.iv !== null ? last.iv - open.iv : null;
  const vsVwap = last.vwap === null ? null : last.straddle - last.vwap;

  return (
    <header className="mh-livebar" aria-label={`${summary.name} ATM straddle, live figures`}>
      {/* The line of its own, so the bar can centre it: baselines line up inside the row, and the
          row sits in the middle of the bar's height. Everything hung off the bar itself sat at the
          top of it, with a third of the bar empty underneath (user, 2026-11-02). */}
      <div className="mh-livebar-row" ref={fit}>
        {/* What the board is on: the name, then the contract behind it in the quiet ink. */}
        <span className="mh-livebar-id">
          <span className="mh-livebar-name">{summary.name}</span>
          <span className="mh-livebar-ex" data-drop={DROP.exchange}>
            {summary.exchange}
          </span>
        </span>
        <span className="mh-livebar-meta" data-drop={DROP.expiry} title="The expiry on the chart, and the days to it">
          {shortDate(summary.expiry)} <em>{daysTo(summary.expiry)}</em>
        </span>
        <span className="mh-livebar-meta" data-drop={DROP.atm} title="The strike the straddle is on: the one nearest the money">
          <i>ATM</i>
          {fmt0(last.strike)}
        </span>

        <span className="mh-livebar-rule" aria-hidden />

        {/* The page's subject, and the only large number on it, flashing as it moves. */}
        <span className="mh-livebar-hero" title="The ATM straddle: its call plus its put, and its move since the open">
          <b data-tick={flash ?? undefined}>{fmt2(last.straddle)}</b>
          <span className={`mh-livebar-move ${toneOf(change)}`}>
            {signed(change, 2)}
            {changePct === null ? null : <em data-drop={DROP.changePct}>{signed(changePct, 2)}%</em>}
          </span>
        </span>

        {/* The rule goes with the group it opens, so a bar too narrow for even VWAP is not left with
            a rule standing over nothing. */}
        <span className="mh-livebar-rule" data-drop={DROP.vwap} aria-hidden />

        <Figure
          label="VWAP"
          title="The straddle's average price this session, and where it stands against it"
          value={last.vwap}
          line="vwap"
          move={<Move of={vsVwap} places={2} drop={DROP.vsVwap} />}
          drop={DROP.vwap}
        />
        <Figure label="Syn fut" title="The synthetic future: call − put + strike" value={last.synth} line="fut" drop={DROP.synth} />
        <Figure label="Spot" title="The underlying" value={last.spot} line="spot" drop={DROP.spot} />
        <Figure label="CE" title="The ATM call" value={last.call} drop={DROP.legs} />
        <Figure label="PE" title="The ATM put" value={last.put} drop={DROP.legs} />
        <Figure
          label="IV"
          title="The at-the-money implied vol, and its move in vol points since the open"
          value={last.iv === null ? null : `${last.iv.toFixed(2)}%`}
          line="iv"
          move={<Move of={ivMove} places={2} unit="pts" drop={DROP.iv} />}
          drop={DROP.iv}
        />
        {last.vix === null ? null : <Figure label="VIX" title="India VIX" value={last.vix} line="vix" drop={DROP.vix} />}

        <span className="mh-spacer" />
        {/* The session, said the same way open or shut: the dot carries which, the words say what. */}
        {closedOn ? (
          <span className="mh-livebar-state mh-livebar-closed" title="The market is shut: these are that session's closing figures, not live ones">
            <span className="mh-dot" aria-hidden />
            Closed
            <em data-drop={DROP.closedDay}>{closedOn}</em>
          </span>
        ) : (
          <span className="mh-livebar-state" title="Minutes are arriving now">
            <span className="mh-dot mh-ok" aria-hidden />
            Live
          </span>
        )}
      </div>
    </header>
  );
}
