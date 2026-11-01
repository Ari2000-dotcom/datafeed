import { useEffect, useMemo, useState } from "react";

import { delta76, yearsToExpiry } from "../core/black76";
import { istDate } from "../core/format";
import type { Hub } from "../hub/client";
import type { Bar } from "../hub/types";
import type { DeltaOiRow, DeltaOiState } from "./useDeltaOi";

/** Strikes each side of the money a past session's board can be narrowed to, or the whole chain. */
export const DAY_BANDS = [5, 10, 20, 40, "full"] as const;
export type DayBand = (typeof DAY_BANDS)[number];
export const DEFAULT_DAY_BAND: DayBand = 20;

/**
 * Delta x open interest for a past session: the board as it stood at that day's close, for a day
 * picked on the chart (or the panel), and for the last session while the market is shut.
 *
 * The live panel (`useDeltaOi`) prices every leg from its own quote; a session that is over has no
 * quotes left to subscribe, so this reads what the hub keeps instead:
 *
 * - **The forward and the ATM vol** first, from that session's last straddle minute
 *   (`/straddle_history`): the synthetic future (call − put + strike at the money) and the ATM IV
 *   the hub worked out.
 * - **Open interest**, every strike's call and put at the day's settle (15:40 IST, MCX 23:40),
 *   asked for only once the forward is known: `oi_profile` with `date`, `band` and `forward`. The
 *   latest session and the one before it are Nubra's own `multistrike`, the whole chain in one
 *   call; any older day is rebuilt from each leg's own minute series instead, one Nubra call a
 *   leg, so only `band` strikes around `forward` are asked for there (`"full"` asks for the whole
 *   chain anyway, slower). A strike with no figure stays unknown, never zero.
 * - **Delta** is Black-76 on the forward at the ATM vol for every strike, with the time to expiry
 *   counted from that minute. One vol across the chain, as the scrip chart's Delta × OI view does:
 *   a past day's own leg prices are not kept, so the skew is left out.
 *
 * An older hub answers `oi_profile` only for now and the session before: a day it was not asked
 * about comes back as `needsHub`, never as another day's figures.
 */

interface OiReply {
  at: number;
  prev_at: number;
  strikes: number[];
  call: (number | null)[];
  put: (number | null)[];
  call_prev: (number | null)[];
  put_prev: (number | null)[];
}

export interface DeltaOiDayState extends DeltaOiState {
  /** The hub answered for other days: one that reads only now and the session before. */
  needsHub: boolean;
}

const EMPTY: DeltaOiDayState = {
  rows: [],
  spot: null,
  forward: null,
  atm: null,
  atmIv: null,
  callTotal: 0,
  putTotal: 0,
  net: 0,
  callOiTotal: 0,
  putOiTotal: 0,
  covered: 0,
  inBand: 0,
  strikesTotal: 0,
  legs: 0,
  ready: false,
  waiting: "",
  error: "",
  noOi: false,
  limited: false,
  needsHub: false,
};

export function useDeltaOiDay(hub: Hub, underlying: string, expiry: string, day: string, band: DayBand): DeltaOiDayState {
  const key = underlying && expiry && day ? `${underlying}|${expiry}|${day}` : "";
  const [oi, setOi] = useState<{ key: string; reply?: OiReply; error?: string } | null>(null);
  const [close, setClose] = useState<{ key: string; bar?: Bar; error?: string } | null>(null);

  // The session's last straddle minute first: the forward that centers the open interest read
  // below (a past day's whole chain, each leg its own Nubra call, is too much to ask for — see
  // `oi_profile::OiProfiles::get`), and the ATM vol at the close.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const q = new URLSearchParams({ underlying, expiry, date: day });
    fetch(`/straddle_history?${q}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || `The hub answered ${res.status}`);
        const bars = ((await res.json()) as { bars: Bar[] }).bars;
        if (cancelled) return;
        const bar = bars[bars.length - 1];
        setClose(bar ? { key, bar } : { key, error: "No session was traded that day." });
      })
      .catch((e: Error) => !cancelled && setClose({ key, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [key, underlying, expiry, day]);

  // The day's open interest, every strike (`band: "full"`) or `band` either side of the close's
  // forward — once known, so a past day's per-leg fallback reads only what the panel can show.
  useEffect(() => {
    if (!key || close?.key !== key) return;
    if (close.error) {
      setOi({ key, error: close.error });
      return;
    }
    const bar = close.bar;
    if (!bar) return;
    const forward = Number.isFinite(bar.synth) && bar.synth > 0 ? bar.synth : bar.spot;
    let cancelled = false;
    const op: Record<string, unknown> = { op: "oi_profile", underlying, expiries: [expiry], date: day };
    if (band !== "full") {
      op.band = band;
      op.forward = forward;
    }
    hub
      .request<OiReply>(op, "oi_profile")
      .then((reply) => !cancelled && setOi({ key, reply }))
      .catch((e: Error) => !cancelled && setOi({ key, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [hub, key, underlying, expiry, day, band, close]);

  return useMemo(() => {
    if (!key) return EMPTY;
    const reply = oi?.key === key ? oi.reply : undefined;
    const bar = close?.key === key ? close.bar : undefined;
    const error = (oi?.key === key ? oi.error : undefined) ?? (close?.key === key ? close.error : undefined) ?? "";
    if (error) return { ...EMPTY, error };
    if (!reply || !bar) return { ...EMPTY, waiting: !reply ? "Loading the day's open interest" : "Loading the day's close" };

    // The figures for `day`: the reply's own instant, or the session before it.
    const side = istDate(reply.at) === day ? { call: reply.call, put: reply.put } : istDate(reply.prev_at) === day ? { call: reply.call_prev, put: reply.put_prev } : null;
    if (!side) return { ...EMPTY, needsHub: true };

    const forward = Number.isFinite(bar.synth) && bar.synth > 0 ? bar.synth : bar.spot;
    const atmIv = bar.iv !== null && Number.isFinite(bar.iv) && bar.iv > 0 ? bar.iv : null;
    const years = yearsToExpiry(expiry, underlying.startsWith("mcx:"), bar.t);
    const strikes = reply.strikes;
    let atmIndex = -1;
    strikes.forEach((k, i) => {
      if (atmIndex < 0 || Math.abs(k - forward) < Math.abs(strikes[atmIndex]! - forward)) atmIndex = i;
    });
    const from = band === "full" ? 0 : Math.max(0, atmIndex - band);
    const to = band === "full" ? strikes.length : Math.min(strikes.length, atmIndex + band + 1);

    let callTotal = 0;
    let putTotal = 0;
    let callOiTotal = 0;
    let putOiTotal = 0;
    let covered = 0;
    const rows: DeltaOiRow[] = [];
    for (let i = from; i < to; i++) {
      const strike = strikes[i]!;
      const callOi = side.call[i] ?? null;
      const putOi = side.put[i] ?? null;
      const callDelta = atmIv !== null ? delta76(forward, strike, years, atmIv / 100, true) : null;
      const putDelta = atmIv !== null ? delta76(forward, strike, years, atmIv / 100, false) : null;
      const callDeltaOi = callDelta !== null && callOi !== null ? callDelta * callOi : null;
      const putDeltaOi = putDelta !== null && putOi !== null ? putDelta * putOi : null;
      if (callDeltaOi !== null) {
        callTotal += callDeltaOi;
        callOiTotal += callOi!;
      }
      if (putDeltaOi !== null) {
        putTotal += putDeltaOi;
        putOiTotal += putOi!;
      }
      if (callDeltaOi !== null && putDeltaOi !== null) covered++;
      rows.push({ strike, callId: "", putId: "", callOi, putOi, callDelta, putDelta, callDeltaOi, putDeltaOi, atm: i === atmIndex });
    }

    return {
      ...EMPTY,
      rows,
      spot: bar.spot,
      forward,
      atm: atmIndex >= 0 ? strikes[atmIndex]! : null,
      atmIv,
      callTotal,
      putTotal,
      net: callTotal + putTotal,
      callOiTotal,
      putOiTotal,
      covered,
      inBand: rows.length,
      strikesTotal: strikes.length,
      ready: true,
      // Prices and OI both there but no figure at all: the day's OI never came back from the hub.
      noOi: rows.length > 0 && rows.every((r) => r.callOi === null && r.putOi === null),
    };
  }, [key, oi, close, day, expiry, underlying, band]);
}

const SETTLE = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * The session the live panel should stand on while the market is shut: the day the hub's
 * now-read lands on when that read is a session's settle (a weekend, a holiday, before the open)
 * rather than a minute of today's session. Null while today trades, after today's own close (its
 * settle is today's, which the live quotes still carry), or until the hub has answered.
 */
export function useLastSession(hub: Hub, underlying: string, expiry: string): string | null {
  const key = underlying && expiry ? `${underlying}|${expiry}` : "";
  const [found, setFound] = useState<{ key: string; day: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const settle = underlying.startsWith("mcx:") ? "23:40" : "15:40";
    hub
      .request<OiReply>({ op: "oi_profile", underlying, expiries: [expiry] }, "oi_profile")
      .then((reply) => {
        if (cancelled) return;
        const atSettle = SETTLE.format(reply.at) === settle;
        const day = istDate(reply.at);
        setFound({ key, day: atSettle && day < istDate(Date.now()) ? day : null });
      })
      .catch(() => !cancelled && setFound({ key, day: null }));
    return () => {
      cancelled = true;
    };
  }, [hub, key, underlying, expiry]);
  return found?.key === key ? found.day : null;
}
