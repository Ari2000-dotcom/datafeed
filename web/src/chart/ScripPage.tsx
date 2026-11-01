import { useEffect, useMemo, useRef, useState } from "react";

import { dayLabel, expiryDate, expiryDays, fmt0, fmt2, nearestExpiry, pastWeekdays } from "../core/format";
import { previousClose } from "../core/previousClose";
import { useUniverse } from "../core/universe";
import type { Hub } from "../hub/client";
import type { TopicMessage } from "../hub/types";
import { Dropdown } from "../ui/Dropdown";
import {
  AlertIcon,
  AreaChartIcon,
  BaselineIcon,
  CandlesIcon,
  ChartIcon,
  EyeOffIcon,
  HighLowIcon,
  HlcAreaIcon,
  HollowCandlesIcon,
  IndicatorsIcon,
  LineChartIcon,
  LineMarkersIcon,
  OhlcBarsIcon,
  OiBothIcon,
  OiChangeIcon,
  OiTotalIcon,
  Spinner,
  StepLineIcon,
  DeltaOiIcon,
} from "../ui/icons";
import { MultiDropdown } from "../ui/MultiDropdown";
import { useFitRow } from "../ui/fitRow";
import { IntervalPicker } from "./IntervalPicker";
import { ATR_PERIOD, atrPoints, CANDLE_INTERVALS, useCandles } from "./useCandles";
import { delta76, yearsToExpiry } from "../core/black76";
import { useDeltaOi, type Band } from "../greeks/useDeltaOi";
import { useDeltaOiDay, type DayBand } from "../greeks/useDeltaOiDay";
import { DeltaOiSettings } from "./DeltaOiSettings";
import { useDeltaOiView } from "./deltaOiView";
import { useExposureTrend, type ExposureRow } from "./useExposureTrend";
import { useOiProfile, type OiProfileMode } from "./useOiProfile";
import { ScripChart, type LiveTick } from "./ScripChart";
import { CANDLE_PALETTES, paletteColors, useCandlePalette } from "./candlePalette";
import { CHART_TYPES, isLineType, useChartType, type ScripChartType } from "./chartType";
import { INDICATORS, useIndicators } from "./indicators";
import { PanelHeader } from "../shell/headerSlot";
import { PICK_EVENT, readPick } from "../straddle/StraddlePage";

/**
 * Pick any NSE/BSE index or MCX commodity and an interval: its candles on openalgo-charts, price
 * on the right axis, the indicators picked from the Indicators menu (`indicators.ts`), and the OI
 * profile of one or more expiries hung off the price axis, QuantDesk's way (`useOiProfile`,
 * `OiProfileBars`). Live trades build the forming candle (`ScripChart`).
 */

const QUICK = ["NIFTY", "BANKNIFTY", "SENSEX", "CRUDEOIL"];
const DEFAULT_INTERVAL = "5m";

/** A change's sign and colour; nothing either way for no change, never "−0.00". */
const signOf = (v: number) => (v > 0.0049 ? "+" : v < -0.0049 ? "−" : "");
const toneOf = (v: number) => (v > 0.0049 ? "mh-up" : v < -0.0049 ? "mh-down" : "");
type OiView = OiProfileMode | "delta" | "off";
const OI_VIEWS: readonly {
  value: OiView;
  /** On the toolbar's trigger. */
  short: string;
  label: string;
  note: string;
  Icon: typeof OiBothIcon;
}[] = [
  { value: "both", short: "OI + chg", label: "Total OI with today's change", note: "Today's addition marked", Icon: OiBothIcon },
  { value: "oi", short: "Total OI", label: "Total OI", note: "Open interest per strike", Icon: OiTotalIcon },
  { value: "change", short: "OI change", label: "Today's OI change", note: "Added or shed today", Icon: OiChangeIcon },
  { value: "delta", short: "Δ × OI", label: "Delta × OI", note: "Every strike, and its change", Icon: DeltaOiIcon },
  { value: "off", short: "OI off", label: "Hide the OI profile", note: "", Icon: EyeOffIcon },
];

export interface ScripPick {
  id: string;
  name: string;
  interval: string;
}

/** Past sessions the Δ × OI settings offer, as the Delta × OI panel's session picker does. */
const PAST_DAYS = 3;

/** The `each` strikes either side of the one nearest `at`. */
function around<T extends { strike: number }>(rows: readonly T[], at: number, each: number): T[] {
  let atm = 0;
  rows.forEach((r, i) => {
    if (Math.abs(r.strike - at) < Math.abs(rows[atm]!.strike - at)) atm = i;
  });
  return rows.slice(Math.max(0, atm - each), atm + each + 1);
}

export function ScripPage({
  hub,
  themeKey,
  initialId,
  initialInterval,
  follow = false,
  onPick,
}: Readonly<{
  hub: Hub;
  themeKey: string;
  initialId?: string | null;
  initialInterval?: string;
  /** Follow the charts' underlying until this chart's own picker is used (the Desk's board). */
  follow?: boolean;
  onPick?: (pick: ScripPick | null) => void;
}>) {
  const universe = useUniverse(hub);
  const underlyingOf = useMemo(() => new Map(universe.map((u) => [u.id, u] as const)), [universe]);
  const underlyingOptions = useMemo(
    () => universe.map((u) => ({ value: u.id, label: u.name, note: u.id.split(":")[0]!.toUpperCase() })),
    [universe],
  );

  const [id, setId] = useState(initialId ?? "");
  const [interval, setInterval_] = useState(
    initialInterval && CANDLE_INTERVALS.some((c) => c.value === initialInterval) ? initialInterval : DEFAULT_INTERVAL,
  );

  // On the Desk's board this chart follows the straddle's underlying, so the three panels are one
  // instrument read three ways — until this chart's own picker is used, which makes it its own, the
  // way an option panel's pick works (`useFollowedPick`). In the Terminal each chart is its own
  // from the start.
  const own = useRef(!follow);
  const pickOwn = (next: string) => {
    own.current = true;
    setId(next);
  };
  useEffect(() => {
    if (!follow) return;
    const followed = () => {
      if (own.current) return;
      const picked = readPick();
      if (picked) setId(picked.underlying.id);
    };
    window.addEventListener(PICK_EVENT, followed);
    return () => window.removeEventListener(PICK_EVENT, followed);
  }, [follow]);

  useEffect(() => {
    const u = underlyingOf.get(id);
    onPick?.(id ? { id, name: u?.name ?? id, interval } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, interval, underlyingOf]);

  // The OI profile's picked expiries: the nearest one the moment an underlying is picked, free to
  // change from there — QuantDesk's `pickedExpiries` (none still listed falls back to the nearest).
  const [expiries, setExpiries] = useState<string[]>([]);
  const [oiView, setOiView] = useState<OiView>("both");
  const [indicators, setIndicators] = useIndicators();
  const allExpiries = underlyingOf.get(id)?.expiries ?? [];
  const allExpiriesKey = allExpiries.join(",");
  useEffect(() => {
    const near = nearestExpiry(allExpiries);
    setExpiries(near ? [near] : []);
    // A new underlying resets the pick; the same one's expiry list arriving late (the universe
    // was still loading) fills it in rather than leaving the picker stuck on nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, allExpiriesKey]);
  const pickedExpiries = expiries.filter((e) => allExpiries.includes(e));
  // Hidden asks the hub for nothing: no expiries, no profile.
  const deltaOn = oiView === "delta";
  // Delta × OI is for one expiry (the first picked); the other views sum all of them.
  const deltaExpiry = deltaOn ? (pickedExpiries[0] ?? "") : "";

  // How the Δ × OI bars are cut (the settings button): the session, the strikes either side of the
  // money, the side, the units and the span the change is read over. The session is the chart's
  // own and starts at Today for every underlying and expiry, as the Delta × OI panel's does.
  const [doiView, setDoiView] = useDeltaOiView();
  const [session, setSession] = useState("live");
  useEffect(() => setSession("live"), [id, pickedExpiries[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const past = deltaOn && session !== "live";
  const lot = underlyingOf.get(id)?.lot ?? 1;
  const scale = doiView.unit === "lot" ? lot : 1;
  const sessions = [
    { value: "live", label: "Today" },
    ...(deltaExpiry ? pastWeekdays(PAST_DAYS).filter((d) => d <= deltaExpiry) : []).map((d) => ({ value: d, label: dayLabel(d) })),
  ];

  // A past session needs no live profile: it reads its own board (`useDeltaOiDay`) instead.
  const { data: oiProfile } = useOiProfile(hub, id, oiView === "off" || past ? [] : deltaOn ? pickedExpiries.slice(0, 1) : pickedExpiries);

  // Delta × OI over every strike of the expiry. The OI of the whole chain is one request (the same
  // profile as the other views); what a strike's delta needs is the forward and the ATM vol, and
  // those come from the two at-the-money legs alone. Pricing each strike's own legs would mean a
  // live subscription per leg, which the hub's per-visitor limit cuts to a few strikes when other
  // panels are open. So the deltas use one vol across the chain (the ATM's): the skew is left out.
  const doi = useDeltaOi(hub, deltaOn && !past ? id : "", deltaExpiry, 0 as unknown as Band);
  // A past session: that day's board at its close, narrowed to the strikes asked for.
  const day = useDeltaOiDay(hub, past ? id : "", past ? deltaExpiry : "", past ? session : "", doiView.range === "all" ? "full" : (doiView.range as DayBand));
  const heldRows = useRef<{ key: string; rows: ExposureRow[] }>({ key: "", rows: [] });
  const deltaKey = `${id}|${deltaExpiry}|${past ? session : "live"}`;
  const baseRows = useMemo<ExposureRow[]>(() => {
    if (!deltaOn) return [];
    if (past) return day.rows.map((r) => ({ strike: r.strike, callDeltaOi: r.callDeltaOi, putDeltaOi: r.putDeltaOi }));
    // The ATM vol or the forward drops out for a beat now and then (a leg's price not yet in, a vol
    // that does not solve): the bars hold the last good picture then, rather than vanishing.
    if (!oiProfile || doi.forward === null || doi.atmIv === null) return heldRows.current.key === deltaKey ? heldRows.current.rows : [];
    const years = Math.round(yearsToExpiry(deltaExpiry, id.startsWith("mcx:")) * 525_600) / 525_600;
    const vol = doi.atmIv / 100;
    const weigh = (oi: number | undefined, strike: number, call: boolean) => (oi !== undefined && Number.isFinite(oi) ? delta76(doi.forward!, strike, years, vol, call) * oi : null);
    const rows = oiProfile.strikes.map((strike, i) => ({
      strike,
      callDeltaOi: weigh(oiProfile.call[i], strike, true),
      putDeltaOi: weigh(oiProfile.put[i], strike, false),
    }));
    heldRows.current = { key: deltaKey, rows };
    return rows;
  }, [deltaOn, past, day.rows, oiProfile, doi.forward, doi.atmIv, deltaExpiry, id, deltaKey]);
  // The strikes asked for (a past session's are already cut by the hub's read), in the units asked for.
  const deltaRows = useMemo<ExposureRow[]>(() => {
    const at = doi.spot ?? doi.forward;
    const cut = past || doiView.range === "all" || at === null || baseRows.length === 0 ? baseRows : around(baseRows, at, doiView.range);
    if (scale === 1) return cut;
    return cut.map((r) => ({ strike: r.strike, callDeltaOi: r.callDeltaOi === null ? null : r.callDeltaOi * scale, putDeltaOi: r.putDeltaOi === null ? null : r.putDeltaOi * scale }));
  }, [baseRows, past, doiView.range, doi.spot, doi.forward, scale]);
  // Changing the units starts the change over: the readings kept were in the other ones.
  const deltaProfile = useExposureTrend(deltaRows, deltaOn, `${deltaKey}|${doiView.unit}`, doiView.since * 60_000);
  const deltaStatus = past ? (day.error || (day.needsHub ? "Needs the hub update" : day.noOi ? "No open interest that day" : "") || day.waiting) : doi.error || doi.waiting;
  const oiNote = deltaOn ? [past ? `${dayLabel(session)} close` : "", doiView.unit === "lot" ? `× lot ${fmt0(lot)}` : ""].filter(Boolean).join(" · ") || undefined : undefined;

  const spec = CANDLE_INTERVALS.find((c) => c.value === interval) ?? CANDLE_INTERVALS[CANDLE_INTERVALS.length - 1]!;
  const priceId = usePriceId(hub, id, allExpiries);
  const { candles, forKey, loading, error, note } = useCandles(priceId, spec);
  const atr = useMemo(() => atrPoints(candles, ATR_PERIOD), [candles]);
  // The view follows the candles drawn, not the interval asked for: the old interval's candles stay
  // up while the new one loads, and the chart fits the new ones only when they are there.
  const viewKey = forKey;
  const latestAtr = atr[atr.length - 1];
  // The ATR on the candles as the ticks build them (`ScripChart` reports it), else the hub's candles' own.
  const [liveAtr, setLiveAtr] = useState<number | null>(null);
  useEffect(() => setLiveAtr(null), [candles]);
  const atrValue = liveAtr ?? (latestAtr && "value" in latestAtr ? latestAtr.value : null);

  // Yesterday's close: the reference every "Chg" reads from, independent of the chart's own
  // interval — a 5m chart's last two bars are minutes apart, not a day's move.
  const [prevClose, setPrevClose] = useState<number | null>(null);
  useEffect(() => {
    if (!priceId) {
      setPrevClose(null);
      return;
    }
    let cancelled = false;
    previousClose(priceId)
      .then((p) => !cancelled && setPrevClose(p))
      .catch(() => !cancelled && setPrevClose(null));
    return () => {
      cancelled = true;
    };
  }, [priceId]);

  // Today's real last price, live, for the readout; and each live trade for the forming candle.
  // The hub's replay of the last known state (yesterday's, before the open) moves the readout but
  // builds no candle.
  const [live, setLive] = useState<number | null>(null);
  const [tick, setTick] = useState<LiveTick | null>(null);
  // The exchange's average traded price today (a future, an option, a share; never an index).
  const [atp, setAtp] = useState<number | null>(null);
  useEffect(() => {
    setLive(null);
    setTick(null);
    setAtp(null);
    if (!priceId) return;
    return hub.subscribe(`quote:${priceId}`, (msg: TopicMessage) => {
      const q = msg as { ltp?: number; ts?: number; replay?: boolean; atp?: number };
      if (msg.t !== "q" || typeof q.ltp !== "number" || q.ltp <= 0) return;
      setLive(q.ltp);
      // Not from the replay: before the open it is yesterday's session, and the line is today's.
      if (!q.replay && typeof q.atp === "number" && q.atp > 0) setAtp(q.atp);
      if (!q.replay && typeof q.ts === "number") setTick({ price: q.ltp, ts: q.ts });
    });
  }, [hub, priceId]);

  const [chartType, setChartType] = useChartType();
  const [paletteId, setPaletteId] = useCandlePalette();
  // The desk preset reads the theme's tokens, so a theme change resolves it again.
  const colors = useMemo(() => paletteColors(paletteId), [paletteId, themeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = live ?? candles[candles.length - 1]?.close ?? null;
  const chg = last !== null && prevClose !== null ? last - prevClose : null;
  const chgPct = chg !== null && prevClose ? (chg / prevClose) * 100 : null;

  // The strip gives way piece by piece rather than clipping its end: the OI view's name first
  // (its icon stays), then the candle colours, the expiries, and last the OI view itself.
  const fitStrip = useFitRow();

  const quickPick = (name: string) => {
    const u = universe.find((x) => x.name === name);
    if (u) pickOwn(u.id);
  };

  return (
    <div className="mh-page">
      <section className="mh-container" aria-label="Scrip chart">
        <PanelHeader className="mh-strip mh-tv-strip" rowRef={fitStrip}>
          <Dropdown
            label="Underlying"
            caption={false}
            value={id}
            onChange={pickOwn}
            renderValue={(o) =>
              o ? (
                <>
                  <span className="mh-symbol">{o.label}</span> <span className="mh-chip">{o.value.split(":")[0]!.toUpperCase()}</span>
                </>
              ) : (
                "Pick an underlying"
              )
            }
            options={underlyingOptions}
          />
          <span className="mh-tv-sep" aria-hidden />
          <IntervalPicker value={interval} onChange={setInterval_} />
          <span className="mh-tv-sep" aria-hidden />
          {/* TradingView's toolbar: no chevron on the chart type, the candles or the indicators. */}
          <span className="mh-tv-bare">
            <Dropdown
              label="Chart type"
              caption={false}
              value={chartType}
              onChange={setChartType}
              renderValue={() => <ChartTypeIcon type={chartType} />}
              options={CHART_TYPES.map((t) => ({ value: t.id, label: t.name, icon: <ChartTypeIcon type={t.id} />, separator: t.group }))}
            />
            {/* A line or an area draws in one colour: the up/down pair only means something to candles and bars. */}
            {isLineType(chartType) ? null : (
              <span className="mh-fit-piece" data-drop={2}>
                <Dropdown
                  label="Candles"
                  caption={false}
                  value={paletteId}
                  onChange={setPaletteId}
                  renderValue={() => <Swatch up={colors.up} down={colors.down} />}
                  options={CANDLE_PALETTES.map((p) => {
                    const c = paletteColors(p.id);
                    return { value: p.id, label: p.name, icon: <Swatch up={c.up} down={c.down} /> };
                  })}
                />
              </span>
            )}
            <span className="mh-tv-sep" aria-hidden />
            <MultiDropdown
              label="Indicators"
              icon={<IndicatorsIcon />}
              value={indicators}
              onChange={setIndicators}
              options={INDICATORS.map((d) => ({ value: d.id, label: d.name, note: d.note }))}
            />
          </span>
          {id && allExpiries.length > 0 ? (
            <>
              <span className="mh-fit-piece" data-drop={3}>
                <span className="mh-tv-sep" aria-hidden />
                <MultiDropdown
                  label="Expiry"
                  caption={false}
                  value={pickedExpiries}
                  onChange={setExpiries}
                  renderValue={(picked) =>
                    picked.length === 0 ? (
                      "No expiry"
                    ) : picked.length === 1 ? (
                      // As the straddle's toolbar writes it: the date, then the days left in the quieter ink.
                      <>
                        {expiryDate(picked[0]!.value)} <span className="mh-picker-aside">{expiryDays(picked[0]!.value)}</span>
                      </>
                    ) : (
                      `${picked.length} expiries`
                    )
                  }
                  options={allExpiries.map((e) => ({ value: e, label: dayLabel(e) }))}
                />
              </span>
              <span className="mh-fit-piece" data-drop={4}>
                <Dropdown
                  label="OI profile"
                  caption={false}
                  value={oiView}
                  onChange={setOiView}
                  renderValue={(o) => {
                    const v = OI_VIEWS.find((x) => x.value === o?.value);
                    return v ? (
                      <>
                        <v.Icon /> <span data-drop={1}>{v.short}</span>
                        {deltaOn && deltaRows.length === 0 ? <span className="mh-chip">{deltaStatus}</span> : null}
                      </>
                    ) : null;
                  }}
                  options={OI_VIEWS.map(({ value, label, note, Icon }) => ({ value, label, note, icon: <Icon />, separator: value === "off" }))}
                />
                {deltaOn ? <DeltaOiSettings view={doiView} onChange={setDoiView} session={session} sessions={sessions} onSession={setSession} lot={lot} /> : null}
              </span>
            </>
          ) : null}
        </PanelHeader>
        <div className="mh-container-body">
          {id && candles.length > 0 ? (
            <ScripChart
              candles={candles}
              chartType={chartType}
              indicators={indicators}
              tick={tick}
              onAtr={setLiveAtr}
              atp={atp}
              stepSec={spec.seconds}
              name={underlyingOf.get(id)?.name ?? id}
              exchange={id.split(":")[0]!.toUpperCase()}
              // TradingView's short form: minutes as a bare number ("5"), then "1h", "1D".
              intervalLabel={spec.seconds < 3600 ? String(spec.seconds / 60) : spec.label}
              onRemoveIndicator={(gone) => setIndicators(indicators.filter((x) => x !== gone))}
              colors={colors}
              oiProfile={oiView === "off" ? null : deltaOn ? deltaProfile : oiProfile}
              oiMode={oiView === "off" ? "both" : deltaOn ? "both" : oiView}
              oiUnit={deltaOn ? "delta" : "oi"}
              oiSides={deltaOn ? doiView.sides : "both"}
              oiSince={past ? null : doiView.since}
              oiNote={oiNote}
              viewKey={viewKey}
              themeKey={themeKey}
              readouts={
                // On the chart, so every chart in a layout reads its own: the day's move from
                // yesterday's close and the ATR, and a new interval loading behind the candles up.
                last !== null ? (
                  <span className="mh-chart-readouts">
                    {loading || note ? (
                      <span className="mh-hint">
                        <Spinner size={13} />
                        {note ?? `Loading ${spec.name}`}
                      </span>
                    ) : null}
                    <span className="mh-readgroup">
                      <span className="mh-readout">
                        <span className="mh-readout-label">Last</span>
                        <span className="mh-readout-value">{fmt2(last)}</span>
                        {chg !== null && chgPct !== null ? (
                          <>
                            <span className={`mh-readout-delta ${toneOf(chg)}`}>
                              {signOf(chg)}
                              {fmt2(Math.abs(chg))}
                            </span>
                            <span className={`mh-readout-move ${toneOf(chg)}`}>
                              {signOf(chgPct)}
                              {Math.abs(chgPct).toFixed(2)}%
                            </span>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="mh-readgroup">
                      <span className="mh-readout">
                        <span className="mh-readout-label">ATR {ATR_PERIOD}</span>
                        <span className="mh-readout-value">{atrValue !== null ? fmt2(atrValue) : "—"}</span>
                      </span>
                    </span>
                  </span>
                ) : undefined
              }
            />
          ) : id ? (
            <div className="mh-empty">
              {error ? (
                <>
                  <span className="mh-empty-icon mh-error">
                    <AlertIcon size={26} />
                  </span>
                  <div className="mh-empty-title">Nothing to draw</div>
                  <div className="mh-empty-text">{error}</div>
                </>
              ) : (
                <>
                  <Spinner size={20} />
                  <div className="mh-empty-title">{note ?? (loading ? "Loading candles" : "No candles for this range")}</div>
                  <div className="mh-empty-text">{underlyingOf.get(id)?.name ?? id}</div>
                </>
              )}
            </div>
          ) : (
            <div className="mh-empty">
              <span className="mh-empty-icon">
                <ChartIcon size={28} />
              </span>
              <div className="mh-empty-title">Pick an underlying</div>
              <div className="mh-empty-text">Candles, the OI profile and your indicators for any index or commodity.</div>
              <div className="mh-quick">
                {QUICK.map((name) => (
                  <button key={name} type="button" className="mh-btn" disabled={universe.length === 0} onClick={() => quickPick(name)}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** A candle preset's pair: an up candle beside a down one. */
function Swatch({ up, down }: Readonly<{ up: string; down: string }>) {
  return (
    <span className="mh-swatch" aria-hidden>
      <i style={{ background: up }} />
      <i style={{ background: down }} />
    </span>
  );
}

const TYPE_ICONS: Record<ScripChartType, typeof CandlesIcon> = {
  bar: OhlcBarsIcon,
  candlestick: CandlesIcon,
  "hollow-candle": HollowCandlesIcon,
  line: LineChartIcon,
  "line-markers": LineMarkersIcon,
  step: StepLineIcon,
  area: AreaChartIcon,
  "hlc-area": HlcAreaIcon,
  baseline: BaselineIcon,
  "high-low": HighLowIcon,
};

/** A chart type's picture, as TradingView's chart-type button shows it. */
function ChartTypeIcon({ type }: Readonly<{ type: ScripChartType }>) {
  const Icon = TYPE_ICONS[type];
  return <Icon />;
}

/**
 * What the price candles are asked by. An index or a share has a spot price; an MCX commodity has
 * none, and its price is its future, the one its options are written on. The hub names that future
 * in a straddle's first message, so this reads it from there once and lets the topic go.
 */
function usePriceId(hub: Hub, id: string, expiries: readonly string[]): string {
  const mcx = id.startsWith("mcx:");
  const expiry = mcx ? nearestExpiry(expiries) : "";
  const [future, setFuture] = useState<{ for: string; id: string } | null>(null);
  useEffect(() => {
    if (!mcx || !expiry) return;
    let stop: (() => void) | null = null;
    stop = hub.subscribe(`straddle:${id}:${expiry}`, (msg: TopicMessage) => {
      const reference = (msg as { reference?: unknown }).reference;
      if (msg.t !== "straddle_snapshot" || typeof reference !== "string" || !reference) return;
      setFuture({ for: id, id: reference });
      stop?.();
      stop = null;
    });
    return () => stop?.();
  }, [hub, id, mcx, expiry]);
  if (!mcx) return id;
  return future?.for === id ? future.id : "";
}
