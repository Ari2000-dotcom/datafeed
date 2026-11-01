//! The OI profile: every strike's call and put open interest for one or more expiries of an
//! underlying, from Nubra's `charts/multistrike`, as QuantDesk draws it on its price axis.
//!
//! One request carries the whole chain, where subscribing to each leg's quote would take two
//! topics per strike (a NIFTY expiry lists ~235 strikes; a visitor may hold 120 topics) and the
//! quotes carry no open interest anyway. It asks for two instants at once: now (or the last
//! session's settle, outside the session), and the previous session's settle, so the browser can
//! draw today's change without a second request.
//!
//! What `multistrike` answers (probed by QuantDesk, `examples/nubra_oichg_probe.rs`): OI **as of**
//! the instant, a quiet leg's last print, but only within the same IST day (09:00 answers
//! nothing). OI keeps moving after the bell and settles by 15:39 on NSE/BSE, so a session's
//! figure is read at 15:40 (QuantDesk `oi_replay.rs`). A side missing from a strike means no
//! figure, never zero.
//!
//! Asked with a `date`, the same two instants for that past session: its settle, and the session
//! before it's, so a browser showing a past day (or the last session while the market is shut)
//! can work out that day's delta x open interest.
//!
//! `multistrike` only carries the latest session minute by minute, and one flat close figure for
//! the session right before it (probed by QuantDesk, `oi_replay.rs`): any older instant answers
//! nothing there. Such a day is rebuilt instead from each leg's own minute OI series
//! (`charts/timeseries`, `Nubra::option_oi_series`) — one Nubra call a leg, so `band` strikes
//! around `forward` are asked for rather than the whole chain (`get`'s doc).
//!
//! Answers are kept a minute and shared by every visitor asking for the same expiries, so a
//! crowd watching NIFTY costs Nubra one call a minute, inside the limiter candle history uses.

use crate::brokers::nubra::{nubra_symbol, Nubra};
use crate::canonical::{Canonical, Market, Right};
use crate::instruments::{Described, Instruments};
use chrono::{DateTime, Datelike, Duration as CDur, NaiveDate, NaiveTime, TimeZone, Utc, Weekday};
use futures_util::stream::{self, StreamExt};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;

/// Symbols per `option_oi_series` query (Nubra's own cap: more come back missing, not erroring).
const LEGS_PER_QUERY: usize = 8;
/// Batches of a past day's per-leg OI in flight at once.
const LEG_QUERIES_IN_FLIGHT: usize = 4;

/// How long an answer is shared before Nubra is asked again.
const KEEP: Duration = Duration::from_secs(60);
/// How far back a past session can be asked for, in calendar days.
const OLDEST_DAYS: i64 = 31;

pub struct OiProfiles {
    nubra: Arc<Nubra>,
    instruments: Arc<Instruments>,
    /// By underlying and expiries: when it was fetched, and the reply. Held across the fetch, so
    /// visitors asking at once share one call.
    cache: AsyncMutex<HashMap<String, (Instant, Arc<Value>)>>,
}

impl OiProfiles {
    pub fn new(nubra: Arc<Nubra>, instruments: Arc<Instruments>) -> Arc<Self> {
        Arc::new(Self { nubra, instruments, cache: AsyncMutex::new(HashMap::new()) })
    }

    /// The profile of `underlying` (`nse:nifty`) over `expiries`, summed strike by strike: now, or
    /// at `date`'s settle when one is given.
    ///
    /// `band` and `forward` matter only for a day older than the last session (the per-leg
    /// fallback, see `fetch`): `band` strikes either side of `forward`, each leg its own Nubra
    /// call, so a day no one has asked for yet costs Nubra two calls a strike rather than one for
    /// the whole chain. `band: None` (or no `forward` to center it on) reads every strike, as the
    /// live and multistrike-covered days always have.
    pub async fn get(&self, underlying: &str, expiries: &[NaiveDate], date: Option<NaiveDate>, band: Option<u32>, forward: Option<f64>) -> Result<Arc<Value>, String> {
        let mut expiries = expiries.to_vec();
        expiries.sort();
        expiries.dedup();
        if expiries.is_empty() {
            return Err("pick at least one expiry".into());
        }
        let day = date.map_or_else(String::new, |d| d.to_string());
        let scope = match (band, forward) {
            (Some(b), Some(f)) => format!("{b}@{f}"),
            _ => String::new(),
        };
        let key = format!("{underlying}|{}|{day}|{scope}", expiries.iter().map(|e| e.to_string()).collect::<Vec<_>>().join(","));
        let mut cache = self.cache.lock().await;
        cache.retain(|_, (at, _)| at.elapsed() < KEEP);
        if let Some((_, v)) = cache.get(&key) {
            return Ok(v.clone());
        }
        let v = Arc::new(self.fetch(underlying, &expiries, date, band, forward).await?);
        cache.insert(key, (Instant::now(), v.clone()));
        Ok(v)
    }

    async fn fetch(&self, underlying: &str, expiries: &[NaiveDate], date: Option<NaiveDate>, band: Option<u32>, forward: Option<f64>) -> Result<Value, String> {
        let canonical = Canonical::parse(underlying)?;
        let market = match &canonical {
            Canonical::Underlying { market, .. } => *market,
            _ => return Err(format!("{underlying}: give an underlying, e.g. nse:nifty")),
        };
        let name = canonical.name_upper();
        let lower = name.to_ascii_lowercase();
        let mut strikes: Vec<f64> = Vec::new();
        for &expiry in expiries {
            let chain = tokio::task::block_in_place(|| self.instruments.chain(market, &name, expiry)).map_err(|e| e.to_string())?;
            strikes.extend(chain.iter().map(|s| s.strike));
        }
        strikes.sort_by(f64::total_cmp);
        strikes.dedup();
        if strikes.is_empty() {
            return Err(format!("{underlying}: no strikes for those expiries"));
        }
        let exchange = exchange_of(market);
        let (now, prev) = match date {
            Some(day) => day_instants(market, day, Utc::now())?,
            None => instants(market, Utc::now()),
        };

        // `multistrike` only carries the latest session minute by minute, and one flat close
        // figure for the session right before it — any older instant answers nothing there (see
        // the module note). Those are rebuilt from each leg's own minute OI series instead, one
        // Nubra call per leg, so (unlike multistrike) only `band` strikes around `forward` are
        // asked for — the whole chain otherwise (`band` or `forward` not given).
        let today = Utc::now().with_timezone(&crate::clock::ist()).date_naive();
        let recent = |t: DateTime<Utc>| {
            let d = t.with_timezone(&crate::clock::ist()).date_naive();
            d == today || d == previous_weekday(today)
        };
        let (live, past): (Vec<DateTime<Utc>>, Vec<DateTime<Utc>>) = [now, prev].into_iter().partition(|&t| recent(t));

        let mut at_now = BTreeMap::new();
        let mut at_prev = BTreeMap::new();
        let mut past = past;
        if !live.is_empty() {
            let body = request_body(exchange, &name, expiries, &strikes, &live);
            let answer = self.nubra.multistrike(&body).await?;
            if live.contains(&now) {
                at_now = oi_at(&answer, exchange, &name, expiries, now);
                if needs_legs(&at_now, band, forward) {
                    past.push(now);
                }
            }
            if live.contains(&prev) {
                at_prev = oi_at(&answer, exchange, &name, expiries, prev);
                if needs_legs(&at_prev, band, forward) {
                    past.push(prev);
                }
            }
        }
        if !past.is_empty() {
            let leg_strikes = banded_strikes(&strikes, band, forward);
            for &t in &past {
                let day = t.with_timezone(&crate::clock::ist()).date_naive();
                let legs = self.leg_oi_at(market, &lower, expiries, &leg_strikes, day, t).await?;
                if t == now {
                    at_now = legs;
                } else {
                    at_prev = legs;
                }
            }
        }

        let side = |at: &BTreeMap<i64, Sides>, strike: f64, put: bool| -> Value {
            at.get(&paise(strike)).and_then(|s| if put { s.put } else { s.call }).map_or(Value::Null, |v| json!(v))
        };
        Ok(json!({
            "at": now.timestamp_millis(),
            "prev_at": prev.timestamp_millis(),
            "strikes": strikes,
            "call": strikes.iter().map(|&s| side(&at_now, s, false)).collect::<Vec<_>>(),
            "put": strikes.iter().map(|&s| side(&at_now, s, true)).collect::<Vec<_>>(),
            "call_prev": strikes.iter().map(|&s| side(&at_prev, s, false)).collect::<Vec<_>>(),
            "put_prev": strikes.iter().map(|&s| side(&at_prev, s, true)).collect::<Vec<_>>(),
        }))
    }

    /// Every strike's call and put OI at `t`, for a session `multistrike` cannot answer: each
    /// leg's own minute OI series through `day` (`charts/timeseries`, `Nubra::option_oi_series`),
    /// taking the last point at or before `t` (a quiet leg's last print). A leg with no point by
    /// then has not traded yet and stays unknown, never zero.
    async fn leg_oi_at(
        &self,
        market: Market,
        name_lower: &str,
        expiries: &[NaiveDate],
        strikes: &[f64],
        day: NaiveDate,
        t: DateTime<Utc>,
    ) -> Result<BTreeMap<i64, Sides>, String> {
        let exchange = exchange_of(market);
        let mut legs: Vec<(i64, Right, String)> = Vec::new();
        for &expiry in expiries {
            let monthly = self.instruments.monthly_for(market, &name_lower.to_ascii_uppercase(), expiry);
            for &strike in strikes {
                for right in [Right::Call, Right::Put] {
                    let d = Described { canonical: Canonical::Option { market, name: name_lower.to_string(), expiry, strike, right }, index: false, monthly };
                    if let Some((symbol, _)) = nubra_symbol(&d) {
                        legs.push((paise(strike), right, symbol));
                    }
                }
            }
        }

        let batches: Vec<Vec<(i64, Right, String)>> = legs.chunks(LEGS_PER_QUERY).map(<[_]>::to_vec).collect();
        let cutoff = t.timestamp_millis();
        let mut out: BTreeMap<i64, Sides> = BTreeMap::new();
        let mut answers = stream::iter(batches)
            .map(|batch| async move {
                let symbols: Vec<String> = batch.iter().map(|(_, _, s)| s.clone()).collect();
                let answer = self.nubra.option_oi_series(exchange, &symbols, day).await.map_err(|e| match e {
                    crate::brokers::FetchError::Auth(m) | crate::brokers::FetchError::Other(m) => m,
                    crate::brokers::FetchError::RateLimited(_) => "nubra is busy; the OI profile will try again".into(),
                })?;
                Ok::<_, String>((batch, answer))
            })
            .buffer_unordered(LEG_QUERIES_IN_FLIGHT);
        while let Some(result) = answers.next().await {
            let (batch, answer) = result?;
            for (strike_paise, right, symbol) in batch {
                let Some(oi) = last_oi_at_or_before(&answer, &symbol, cutoff) else { continue };
                let entry = out.entry(strike_paise).or_default();
                match right {
                    Right::Call => entry.call = Some(entry.call.unwrap_or(0.0) + oi),
                    Right::Put => entry.put = Some(entry.put.unwrap_or(0.0) + oi),
                }
            }
        }
        Ok(out)
    }
}

fn exchange_of(market: Market) -> &'static str {
    match market {
        Market::Nse => "NSE",
        Market::Bse => "BSE",
        Market::Mcx => "MCX",
    }
}

/// A strike as Nubra keys it: paise, as an integer (23,250 → 2,325,000).
fn paise(strike: f64) -> i64 {
    (strike * 100.0).round() as i64
}

/// When a market opens, and when its open interest has settled after the close, IST.
fn session(market: Market) -> (NaiveTime, NaiveTime) {
    let t = |h, m| NaiveTime::from_hms_opt(h, m, 0).expect("valid time");
    match market {
        Market::Nse | Market::Bse => (t(9, 15), t(15, 40)),
        Market::Mcx => (t(9, 0), t(23, 40)),
    }
}

fn previous_weekday(d: NaiveDate) -> NaiveDate {
    let mut d = d - CDur::days(1);
    while matches!(d.weekday(), Weekday::Sat | Weekday::Sun) {
        d -= CDur::days(1);
    }
    d
}

/// The instant to read now (the current minute in session, else the last session's settle) and
/// the session before it's settle, the reference for today's change. A holiday reads nothing and
/// comes back without figures, never as zero.
fn instants(market: Market, now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>) {
    let ist = crate::clock::ist();
    let local = now.with_timezone(&ist);
    let (open, settle) = session(market);
    let at = |d: NaiveDate, t: NaiveTime| ist.from_local_datetime(&d.and_time(t)).single().expect("IST has no gaps").with_timezone(&Utc);
    let today = local.date_naive();
    let weekday = !matches!(today.weekday(), Weekday::Sat | Weekday::Sun);
    let session_day = if weekday && local.time() >= open { today } else { previous_weekday(today) };
    let read = if session_day == today {
        // The last whole minute, no later than the settle.
        let minute = now - CDur::seconds(now.timestamp() % 60) - CDur::nanoseconds(i64::from(now.timestamp_subsec_nanos()));
        minute.min(at(today, settle))
    } else {
        at(session_day, settle)
    };
    (read, at(previous_weekday(session_day), settle))
}

/// A past session's two instants: `day`'s settle and the session before it's. Today reads as
/// `instants` does (the current minute in session); a weekend, a day still to come or one older
/// than `OLDEST_DAYS` has no session to read.
fn day_instants(market: Market, day: NaiveDate, now: DateTime<Utc>) -> Result<(DateTime<Utc>, DateTime<Utc>), String> {
    let ist = crate::clock::ist();
    let today = now.with_timezone(&ist).date_naive();
    if matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
        return Err(format!("{day} is a weekend: there is no session to read"));
    }
    if day > today {
        return Err(format!("{day} has not traded yet"));
    }
    if (today - day).num_days() > OLDEST_DAYS {
        return Err(format!("{day} is more than {OLDEST_DAYS} days back"));
    }
    if day == today {
        return Ok(instants(market, now));
    }
    let (_, settle) = session(market);
    let at = |d: NaiveDate| ist.from_local_datetime(&d.and_time(settle)).single().expect("IST has no gaps").with_timezone(&Utc);
    Ok((at(day), at(previous_weekday(day))))
}

fn rfc3339(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// A recent instant `multistrike` answered with nothing at all, for a caller that narrowed the read
/// (`band` around `forward`): read it leg by leg instead. Seen on a weekend, when the latest
/// session's settle answers empty there while the session before it answers in full (probed
/// 2026-11-01, NIFTY and CRUDEOIL). Without a band the fallback would be the whole chain, a Nubra
/// call per eight legs, so an unnarrowed caller (the live OI profile) keeps the empty answer.
fn needs_legs(at: &BTreeMap<i64, Sides>, band: Option<u32>, forward: Option<f64>) -> bool {
    at.is_empty() && band.is_some() && forward.is_some()
}

/// `strikes` (ascending), narrowed to `band` either side of the one nearest `forward` — the per-leg
/// fallback's scope, since each strike there costs Nubra its own call. Either missing, the whole
/// list: a live-covered day, or a visitor who asked for the full chain.
fn banded_strikes(strikes: &[f64], band: Option<u32>, forward: Option<f64>) -> Vec<f64> {
    let (Some(band), Some(forward)) = (band, forward) else { return strikes.to_vec() };
    if strikes.is_empty() {
        return Vec::new();
    }
    let mid = strikes
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| (**a - forward).abs().total_cmp(&(**b - forward).abs()))
        .map(|(i, _)| i)
        .unwrap_or(0);
    let band = band as usize;
    let from = mid.saturating_sub(band);
    let to = (mid + band + 1).min(strikes.len());
    strikes[from..to].to_vec()
}

/// The request, as nubra.io's own OI chart sends it: one query per instant, strikes in paise,
/// expiries as `YYYYMMDD`.
fn request_body(exchange: &str, asset: &str, expiries: &[NaiveDate], strikes: &[f64], times: &[DateTime<Utc>]) -> Value {
    let keys: Vec<i64> = strikes.iter().map(|&s| paise(s)).collect();
    let min = keys.iter().min().copied().unwrap_or(0);
    let max = keys.iter().max().copied().unwrap_or(0);
    let expiries: Vec<String> = expiries.iter().map(|e| e.format("%Y%m%d").to_string()).collect();
    json!({ "query": times.iter().map(|&t| json!({
        "exchange": exchange,
        "asset": asset,
        "expiries": expiries,
        "minStrike": min,
        "maxStrike": max,
        "strikes": keys,
        "fields": ["cumulative_oi"],
        "time": rfc3339(t),
    })).collect::<Vec<_>>() })
}

#[derive(Debug, Default, Clone, Copy, PartialEq)]
struct Sides {
    call: Option<f64>,
    put: Option<f64>,
}

/// `result[exchange][asset][<time>][<expiry>][<strike paise>].cumulative_oi.{CE,PE}` at the time
/// key that is `t` (Nubra's echo of the asked instant, read as a time rather than matched as
/// text), summed over the expiries. A side with no figure in any expiry stays unknown.
fn oi_at(answer: &Value, exchange: &str, asset: &str, expiries: &[NaiveDate], t: DateTime<Utc>) -> BTreeMap<i64, Sides> {
    let mut out: BTreeMap<i64, Sides> = BTreeMap::new();
    let Some(times) = answer.get("result").and_then(|r| r.get(exchange)).and_then(|e| e.get(asset)).and_then(Value::as_object) else {
        return out;
    };
    let Some(at) = times
        .iter()
        .find(|(k, _)| DateTime::parse_from_rfc3339(k).is_ok_and(|k| k.timestamp() == t.timestamp()))
        .map(|(_, v)| v)
    else {
        return out;
    };
    for expiry in expiries {
        let Some(strikes) = at.get(expiry.format("%Y%m%d").to_string()).and_then(Value::as_object) else { continue };
        for (strike, fields) in strikes {
            let Ok(strike) = strike.parse::<i64>() else { continue };
            let Some(oi) = fields.get("cumulative_oi") else { continue };
            let entry = out.entry(strike).or_default();
            for (side, slot) in [("CE", &mut entry.call), ("PE", &mut entry.put)] {
                if let Some(v) = oi.get(side).or_else(|| oi.get(side.to_lowercase())).and_then(Value::as_f64) {
                    *slot = Some(slot.unwrap_or(0.0) + v);
                }
            }
        }
    }
    out
}

/// `result[0].values[{symbol: {cumulative_oi: [{ts(ns), v}]}}]` (Nubra's `charts/timeseries`,
/// per-leg): `symbol`'s last print at or before `cutoff_ms`, or `None` before its first print —
/// the leg simply had not traded yet, never zero.
fn last_oi_at_or_before(answer: &Value, symbol: &str, cutoff_ms: i64) -> Option<f64> {
    let groups = answer.get("result")?.get(0)?.get("values")?.as_array()?;
    let mut last: Option<(i64, f64)> = None;
    for g in groups {
        let Some(points) = g.get(symbol).and_then(|f| f.get("cumulative_oi")).and_then(Value::as_array) else { continue };
        for p in points {
            let (Some(ts), Some(v)) = (p.get("ts").and_then(Value::as_i64), p.get("v").and_then(Value::as_f64)) else { continue };
            let ms = ts / 1_000_000;
            if ms <= cutoff_ms && last.is_none_or(|(at, _)| ms > at) {
                last = Some((ms, v));
            }
        }
    }
    last.map(|(_, v)| v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    /// The probed shape: strikes in paise under each expiry, sides under `cumulative_oi`, a
    /// missing side left missing; two expiries sum strike by strike; the other instant ignored.
    #[test]
    fn answers_parse_by_strike_and_sum_over_expiries() {
        let answer = json!({ "result": { "NSE": { "NIFTY": {
            "2026-10-28T09:50:00.000Z": {
                "20261103": {
                    "2135000": { "cumulative_oi": { "PE": 2077400 } },
                    "2150000": { "cumulative_oi": { "CE": 0, "PE": 3911765 } }
                },
                "20261110": { "2150000": { "cumulative_oi": { "CE": 100, "PE": 5 } } }
            },
            "2026-10-27T10:10:00.000Z": { "20261103": { "2150000": { "cumulative_oi": { "CE": 7 } } } }
        }}}});
        let expiries = [NaiveDate::from_ymd_opt(2026, 11, 3).unwrap(), NaiveDate::from_ymd_opt(2026, 11, 10).unwrap()];
        let now = oi_at(&answer, "NSE", "NIFTY", &expiries, utc("2026-10-28T09:50:00Z"));
        assert_eq!(now[&paise(21_350.0)], Sides { call: None, put: Some(2_077_400.0) }, "no print is not zero");
        assert_eq!(now[&paise(21_500.0)], Sides { call: Some(100.0), put: Some(3_911_770.0) });
        let prev = oi_at(&answer, "NSE", "NIFTY", &expiries, utc("2026-10-27T10:10:00Z"));
        assert_eq!(prev[&paise(21_500.0)], Sides { call: Some(7.0), put: None });
        assert!(oi_at(&answer, "NSE", "NIFTY", &expiries, utc("2026-10-26T10:10:00Z")).is_empty());
    }

    #[test]
    fn the_request_names_strikes_in_paise_and_one_query_per_instant() {
        let body = request_body("NSE", "NIFTY", &[NaiveDate::from_ymd_opt(2026, 11, 3).unwrap()], &[23_250.0, 23_300.0], &[utc("2026-10-28T09:50:00Z"), utc("2026-10-27T10:10:00Z")]);
        let q = body["query"].as_array().unwrap();
        assert_eq!(q.len(), 2);
        assert_eq!(q[0]["strikes"], json!([2_325_000, 2_330_000]));
        assert_eq!(q[0]["minStrike"], json!(2_325_000));
        assert_eq!(q[0]["expiries"], json!(["20261103"]));
        assert_eq!(q[0]["time"], json!("2026-10-28T09:50:00.000Z"));
        assert_eq!(q[1]["time"], json!("2026-10-27T10:10:00.000Z"));
    }

    /// In session: this minute and yesterday's 15:40. Before the open, on a weekend: the last
    /// session's 15:40 and the one before it (Friday's and Thursday's from a Monday morning).
    #[test]
    fn instants_follow_the_session() {
        // Wed 28 Oct 2026, 11:20:37 IST = 05:50:37Z.
        let (now, prev) = instants(Market::Nse, utc("2026-10-28T05:50:37Z"));
        assert_eq!(rfc3339(now), "2026-10-28T05:50:00.000Z");
        assert_eq!(rfc3339(prev), "2026-10-27T10:10:00.000Z");
        // Mon 2 Nov 2026, 08:00 IST: Friday 30 Oct's settle, then Thursday 29 Oct's.
        let (now, prev) = instants(Market::Nse, utc("2026-11-02T02:30:00Z"));
        assert_eq!(rfc3339(now), "2026-10-30T10:10:00.000Z");
        assert_eq!(rfc3339(prev), "2026-10-29T10:10:00.000Z");
        // After the settle the same day: today's settle, not the clock.
        let (now, _) = instants(Market::Nse, utc("2026-10-28T12:00:00Z"));
        assert_eq!(rfc3339(now), "2026-10-28T10:10:00.000Z");
    }

    fn ymd(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    /// What "Today" reads on a Sunday (`instants`) and what picking that same Friday explicitly
    /// reads (`day_instants`) must be the SAME instant — the live panel and the picked-session
    /// panel are reading the identical close, just by two different routes.
    #[test]
    fn todays_fallback_session_matches_picking_that_day_explicitly() {
        let sunday = utc("2026-11-01T04:00:00Z");
        let (today_now, today_prev) = instants(Market::Nse, sunday);
        let (picked_now, picked_prev) = day_instants(Market::Nse, ymd(2026, 10, 30), sunday).unwrap();
        assert_eq!(today_now, picked_now, "Today's live instant must equal picking Friday explicitly");
        assert_eq!(today_prev, picked_prev, "and the same for the comparison instant");
    }

    /// A past Friday read on a Sunday: its 15:40 IST settle and Thursday's, for NSE; 23:40 for MCX.
    #[test]
    fn a_past_day_reads_its_settle_and_the_session_before() {
        let sunday = utc("2026-11-01T04:00:00Z");
        let (at, prev) = day_instants(Market::Nse, ymd(2026, 10, 30), sunday).unwrap();
        assert_eq!(at, utc("2026-10-30T10:10:00Z"));
        assert_eq!(prev, utc("2026-10-29T10:10:00Z"));
        let (at, prev) = day_instants(Market::Mcx, ymd(2026, 10, 30), sunday).unwrap();
        assert_eq!(at, utc("2026-10-30T18:10:00Z"));
        assert_eq!(prev, utc("2026-10-29T18:10:00Z"));
    }

    /// A Monday's session before is the Friday, skipping the weekend.
    #[test]
    fn a_monday_reaches_back_over_the_weekend() {
        let (at, prev) = day_instants(Market::Nse, ymd(2026, 10, 26), utc("2026-11-01T04:00:00Z")).unwrap();
        assert_eq!(at, utc("2026-10-26T10:10:00Z"));
        assert_eq!(prev, utc("2026-10-23T10:10:00Z"));
    }

    /// No session on a weekend, nothing yet for a day to come, and a limit on how far back.
    #[test]
    fn days_with_no_session_to_read_are_refused() {
        let sunday = utc("2026-11-01T04:00:00Z");
        assert!(day_instants(Market::Nse, ymd(2026, 10, 31), sunday).is_err(), "a Saturday");
        assert!(day_instants(Market::Nse, ymd(2026, 11, 2), sunday).is_err(), "tomorrow");
        assert!(day_instants(Market::Nse, ymd(2026, 9, 1), sunday).is_err(), "two months back");
    }

    /// Today reads as the live call does: the current minute in session.
    #[test]
    fn today_reads_the_current_minute() {
        let monday_noon = utc("2026-11-02T06:30:30Z");
        assert_eq!(day_instants(Market::Nse, ymd(2026, 11, 2), monday_noon).unwrap(), instants(Market::Nse, monday_noon));
    }

    /// The per-leg fallback's shape (`charts/timeseries`, probed via `nubra.rs::parse_candles`):
    /// nanosecond `ts`, a quiet leg's last print carried forward, nothing before its first print.
    #[test]
    fn last_oi_at_or_before_carries_a_quiet_legs_last_print() {
        let ns = |ms: i64| ms * 1_000_000;
        let answer = json!({ "result": [{ "values": [
            { "NIFTY2691523250CE": { "cumulative_oi": [
                { "ts": ns(1_000), "v": 100.0 },
                { "ts": ns(2_000), "v": 150.0 },
                { "ts": ns(5_000), "v": 200.0 },
            ] } },
        ] }] });
        assert_eq!(last_oi_at_or_before(&answer, "NIFTY2691523250CE", 1_500), Some(100.0), "carries the last print before cutoff");
        assert_eq!(last_oi_at_or_before(&answer, "NIFTY2691523250CE", 2_000), Some(150.0), "a print exactly at cutoff counts");
        assert_eq!(last_oi_at_or_before(&answer, "NIFTY2691523250CE", 10_000), Some(200.0));
        assert_eq!(last_oi_at_or_before(&answer, "NIFTY2691523250CE", 500), None, "nothing before the first print");
        assert_eq!(last_oi_at_or_before(&answer, "NIFTY2691523400PE", 10_000), None, "a symbol absent from the answer");
    }

    #[test]
    fn banded_strikes_centers_on_the_strike_nearest_forward() {
        let strikes: Vec<f64> = (0..21).map(|i| 100.0 + i as f64 * 50.0).collect(); // 100..1100
        // Forward 630 is nearest 650 (index 11); band 2 keeps indices 9..=13.
        assert_eq!(banded_strikes(&strikes, Some(2), Some(630.0)), vec![550.0, 600.0, 650.0, 700.0, 750.0]);
        // The band runs off the start or end: clamped, not panicking, never padded.
        assert_eq!(banded_strikes(&strikes, Some(2), Some(100.0)), vec![100.0, 150.0, 200.0]);
        assert_eq!(banded_strikes(&strikes, Some(2), Some(1100.0)), vec![1000.0, 1050.0, 1100.0]);
        // No band, or no forward to center it on: the whole chain, unchanged.
        assert_eq!(banded_strikes(&strikes, None, Some(630.0)), strikes);
        assert_eq!(banded_strikes(&strikes, Some(2), None), strikes);
    }

    /// A day older than the previous session routes through the per-leg fallback, not
    /// `multistrike` (`fetch`'s `recent` split) — today and the session right before it do not.
    #[test]
    fn only_the_latest_two_sessions_are_recent_enough_for_multistrike() {
        // Monday 2 Nov 2026, noon IST: the previous weekday is Friday 30 Oct.
        let today = ymd(2026, 11, 2);
        let recent = |t: DateTime<Utc>| {
            let d = t.with_timezone(&crate::clock::ist()).date_naive();
            d == today || d == previous_weekday(today)
        };
        let (_, settle) = session(Market::Nse);
        let at = |d: NaiveDate| crate::clock::ist().from_local_datetime(&d.and_time(settle)).single().unwrap().with_timezone(&Utc);
        assert!(recent(at(today)), "today's own settle");
        assert!(recent(at(previous_weekday(today))), "Friday, the session right before");
        assert!(!recent(at(ymd(2026, 10, 29))), "Thursday is one session further back");
    }

    /// An empty recent answer goes leg by leg only for a narrowed read; any figure, or no band to
    /// narrow by, keeps what multistrike said.
    #[test]
    fn an_empty_recent_answer_reads_leg_by_leg_only_when_narrowed() {
        let empty = BTreeMap::new();
        let mut some = BTreeMap::new();
        some.insert(paise(23_000.0), Sides { call: Some(1.0), put: None });
        assert!(needs_legs(&empty, Some(20), Some(23_010.0)));
        assert!(!needs_legs(&some, Some(20), Some(23_010.0)), "figures came back");
        assert!(!needs_legs(&empty, None, Some(23_010.0)), "no band: would be the whole chain");
        assert!(!needs_legs(&empty, Some(20), None), "no forward to center on");
    }
}
