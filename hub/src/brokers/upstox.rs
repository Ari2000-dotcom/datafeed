//! Upstox: the world's markets, which the Indian brokers here do not carry. Global indices (GIFT
//! Nifty, Dow Jones, S&P, Nikkei, ...) and indicators (USD INR, Brent, WTI), live feed only.
//!
//! Upstox refreshes these every 20, 120 or 900 seconds (its instrument file's `latency`), so the
//! feed polls the Full Market Quote API every [`POLL`] for every instrument being watched, in one
//! call, and publishes each as a tick when its price or time moved. That is 3 calls a minute against
//! Upstox's 2,000 per 30 minutes.
//!
//! ## Login, as the other brokers do it: never by hand once set up
//!   * **Analytics token (preferred):** generated once in Upstox's Developer Apps console, valid a
//!     year, read-only, and accepted by the market-data APIs without a static IP. Saved as
//!     `UPSTOX_ANALYTICS_TOKEN`, it is simply used.
//!   * **TOTP login (otherwise):** Upstox's official headless login, `POST /v2/totp-login/
//!     authorization/token` with the API key in `x-api-key` and a code from the saved TOTP secret
//!     plus the 6-digit PIN. The token lasts until 03:30 IST the next day; the hub logs in again when
//!     Upstox refuses it. Each login revokes the app's previous token, so it is only done when needed.
//!
//! Failed logins are spaced at least [`LOGIN_MIN_GAP`] apart and stop after [`MAX_LOGIN_FAILURES`]
//! in a row, so a wrong PIN can never lock the account. Saving new credentials resets that.

use crate::creds::CredStore;
use crate::live::{FeedCmd, LiveHub};
use crate::model::{InstrumentId, Tick};
use parking_lot::RwLock;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

const BASE: &str = "https://api.upstox.com";
/// Upstox's fastest global instruments refresh every 20 s; polling faster only repeats them.
const POLL: Duration = Duration::from_secs(20);
const LOGIN_MIN_GAP: Duration = Duration::from_secs(60);
const MAX_LOGIN_FAILURES: u32 = 3;
const LOGIN_KEYS: [&str; 4] = ["UPSTOX_ANALYTICS_TOKEN", "UPSTOX_API_KEY", "UPSTOX_PIN", "UPSTOX_TOTP_SECRET"];

const NEEDS_CREDS: &str = "needs an analytics token, or PIN + TOTP secret (.env / Brokers tab)";

/// One line for the app window.
pub static STATUS: RwLock<String> = parking_lot::const_rwlock(String::new());

fn set_status(s: impl Into<String>) {
    *STATUS.write() = s.into();
}

/// The hub's names for Upstox's global instruments (`quote:global:dji`), and their Upstox keys
/// (`<segment>|<trading symbol>`, from assets.upstox.com/market-quote/instruments/exchange/global.json.gz).
pub const GLOBAL: &[(&str, &str)] = &[
    ("giftnifty", "GLOBAL_INDEX|SGX NIFTY"),
    ("dji", "GLOBAL_INDEX|^DJI"),
    ("spx", "GLOBAL_INDEX|^GSPC"),
    ("nasdaq100", "GLOBAL_INDEX|IXIX"),
    ("us30", "GLOBAL_INDEX|DOW FUTURES"),
    ("ftse", "GLOBAL_INDEX|^FTSE"),
    ("dax", "GLOBAL_INDEX|^GDAXI"),
    ("cac", "GLOBAL_INDEX|^FCHI"),
    ("nikkei", "GLOBAL_INDEX|^N225"),
    ("hsi", "GLOBAL_INDEX|^HSI"),
    ("usdinr", "GLOBAL_INDICATOR|USDINR"),
    ("brent", "GLOBAL_INDICATOR|BZUSD"),
    ("wti", "GLOBAL_INDICATOR|CLUSD"),
];

/// The feed id for a hub name (`dji` → `GLOBAL_INDEX:^DJI`), the form the live engine routes on.
pub fn feed_id(name: &str) -> Option<InstrumentId> {
    GLOBAL.iter().find(|(n, _)| *n == name).map(|(_, key)| InstrumentId(key.replacen('|', ":", 1)))
}

/// Upstox's key for a feed id (`GLOBAL_INDEX:^DJI` → `GLOBAL_INDEX|^DJI`).
fn upstox_key(id: &InstrumentId) -> String {
    format!("{}|{}", id.segment(), id.token())
}

/// The console's status line for Upstox: short, and the same words while nothing changes, so the
/// line (and any Telegram alert built from it) does not flicker with the watched count.
pub fn console_state() -> (String, bool, bool) {
    let st = STATUS.read().clone();
    let (text, up, down) = if st.starts_with("connected") {
        ("connected".to_string(), true, false)
    } else if st.is_empty() || st == "ready" {
        ("ready".to_string(), true, false)
    } else if st.starts_with("login failed") || st.contains("refused") || st.starts_with("quote request failed") {
        (st, false, true)
    } else {
        (st, false, false)
    };
    (format!("upstox: {text}"), up, down)
}

/// Whether the hub can get a token without anyone at the keyboard.
pub fn can_log_in(creds: &CredStore) -> bool {
    creds.is_set("UPSTOX_ANALYTICS_TOKEN")
        || (creds.is_set("UPSTOX_API_KEY") && creds.is_set("UPSTOX_PIN") && creds.is_set("UPSTOX_TOTP_SECRET"))
}

#[derive(Deserialize)]
struct QuoteReply {
    #[serde(default)]
    data: HashMap<String, QuoteEntry>,
}

#[derive(Deserialize)]
struct QuoteEntry {
    instrument_token: String,
    /// Zero or missing for an indicator between its sessions (USD INR outside Indian FX hours).
    #[serde(default)]
    last_price: Option<f64>,
    #[serde(default)]
    net_change: Option<f64>,
    #[serde(default)]
    volume: Option<f64>,
    #[serde(default)]
    last_trade_time: Option<String>,
    /// Yesterday's close, in an LTP V3 reply (the full quote sends `net_change` instead).
    #[serde(default)]
    cp: Option<f64>,
}

/// Ticks out of one Full Market Quote reply: the price, and yesterday's close as price less change.
fn ticks_from(reply: &str, now_ms: i64) -> Result<Vec<Tick>, String> {
    let r: QuoteReply = serde_json::from_str(reply).map_err(|e| format!("unexpected quote reply: {e}"))?;
    Ok(r.data
        .into_values()
        .filter_map(|q| {
            // No price between sessions: the last close stands in, marked as a replay so it is not read as a live move.
            let live = q.last_price.filter(|p| *p > 0.0);
            let close = q.cp.filter(|c| *c > 0.0);
            let (ltp, replay) = match (live, close) {
                (Some(p), _) => (p, false),
                (None, Some(c)) => (c, true),
                (None, None) => return None,
            };
            Some(Tick {
                id: InstrumentId(q.instrument_token.replacen('|', ":", 1)),
                ltp,
                volume: q.volume.filter(|v| *v > 0.0),
                bid: None,
                ask: None,
                oi: None,
                prev_oi: None,
                atp: None,
                prev_close: if replay {
                    None
                } else {
                    q.net_change.map(|c| ((ltp - c) * 100.0).round() / 100.0).or(close)
                },
                ts_ms: q.last_trade_time.and_then(|t| t.parse().ok()).filter(|t: &i64| *t > 0).unwrap_or(now_ms),
                src: "upstox",
                replay,
            })
        })
        .collect())
}

struct Session {
    token: Option<String>,
    last_login: Option<Instant>,
    failures: u32,
}

#[derive(Debug)]
enum UErr {
    /// The token was refused: log in again.
    Auth(String),
    Other(String),
}

/// A token: the analytics token when saved, else today's TOTP login.
async fn token(client: &reqwest::Client, creds: &CredStore, s: &mut Session) -> Result<String, String> {
    if let Some(t) = creds.get("UPSTOX_ANALYTICS_TOKEN") {
        return Ok(t);
    }
    // "-" marks a saved token as spent (the store keeps no blanks).
    if let Some(t) = s.token.clone().or_else(|| creds.get("UPSTOX_ACCESS_TOKEN").filter(|t| t != "-")) {
        s.token = Some(t.clone());
        return Ok(t);
    }
    if !can_log_in(creds) {
        return Err(NEEDS_CREDS.into());
    }
    if s.failures >= MAX_LOGIN_FAILURES {
        return Err(format!("login failed {MAX_LOGIN_FAILURES} times; stopped until the credentials are saved again"));
    }
    if let Some(at) = s.last_login {
        if at.elapsed() < LOGIN_MIN_GAP {
            return Err("waiting before the next login try".into());
        }
    }
    s.last_login = Some(Instant::now());
    set_status("logging in (TOTP)");
    match totp_login(client, creds).await {
        Ok(t) => {
            s.failures = 0;
            s.token = Some(t.clone());
            // Kept so a restart the same day reuses it instead of revoking it with a new login.
            let _ = creds.set_many(&[("UPSTOX_ACCESS_TOKEN".to_string(), t.clone())]);
            tracing::info!("upstox: logged in with TOTP");
            Ok(t)
        }
        Err(e) => {
            s.failures += 1;
            Err(format!("login failed: {e}"))
        }
    }
}

async fn totp_login(client: &reqwest::Client, creds: &CredStore) -> Result<String, String> {
    let key = creds.get("UPSTOX_API_KEY").ok_or("API key not set")?;
    let pin = creds.get("UPSTOX_PIN").ok_or("PIN not set")?;
    let secret = creds.get("UPSTOX_TOTP_SECRET").ok_or("TOTP secret not set")?;
    let bytes = totp_rs::Secret::Encoded(secret.replace(' ', "").to_uppercase())
        .to_bytes()
        .map_err(|_| "TOTP secret is not valid (letters A-Z and digits 2-7)".to_string())?;
    let totp = totp_rs::TOTP::new_unchecked(totp_rs::Algorithm::SHA1, 6, 1, 30, bytes);
    let code = totp.generate_current().map_err(|e| e.to_string())?;
    let res = client
        .post(format!("{BASE}/v2/totp-login/authorization/token"))
        .header("accept", "application/json")
        .header("x-api-key", key)
        .json(&serde_json::json!({ "totp": code, "pin": pin }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    let token = v["data"]["access_token"].as_str().or_else(|| v["access_token"].as_str());
    match token {
        Some(t) if status.is_success() && !t.is_empty() => Ok(t.to_string()),
        _ => {
            let msg = v["errors"][0]["message"].as_str().unwrap_or(&body);
            Err(format!("HTTP {}: {}", status.as_u16(), msg.chars().take(160).collect::<String>()))
        }
    }
}

/// Percent-encodes a key for the query string, a space as `%20`: form encoding's `+` (what
/// reqwest's `.query()` writes) is not read as a space by Upstox, so `SGX NIFTY` came back unknown.
fn encode_key(key: &str) -> String {
    let mut out = String::with_capacity(key.len() * 2);
    for b in key.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Upstox's answer when a key in the request is not one it knows; one such key fails the whole call.
fn is_unknown_key(e: &UErr) -> bool {
    matches!(e, UErr::Other(m) if m.contains("UDAPI1087"))
}

/** Full Market Quote: price, change on yesterday and volume. Serves the global indices. */
const FULL: &str = "/v2/market-quote/quotes";
/** LTP V3: price, volume and yesterday's close (`cp`). Serves what the full quote refuses (USD INR, crude). */
const LTP: &str = "/v3/market-quote/ltp";

async fn fetch(client: &reqwest::Client, token: &str, path: &str, keys: &[String]) -> Result<String, UErr> {
    let list = keys.iter().map(|k| encode_key(k)).collect::<Vec<_>>().join(",");
    get(client, token, &format!("{BASE}{path}?instrument_key={list}")).await
}

async fn get(client: &reqwest::Client, token: &str, url: &str) -> Result<String, UErr> {
    let res = client
        .get(url)
        .header("accept", "application/json")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| UErr::Other(e.to_string()))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| UErr::Other(e.to_string()))?;
    match status.as_u16() {
        200 => Ok(body),
        401 | 403 => Err(UErr::Auth(format!("HTTP {}", status.as_u16()))),
        s => Err(UErr::Other(format!("HTTP {s}: {}", body.chars().take(160).collect::<String>()))),
    }
}

/// The newest candle's time (ms) and close out of a candle reply (`data.candles`, newest first).
fn newest_candle(body: &str) -> Option<(i64, f64)> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    v["data"]["candles"]
        .as_array()?
        .iter()
        .filter_map(|c| {
            let ts = chrono::DateTime::parse_from_rfc3339(c.get(0)?.as_str()?).ok()?.timestamp_millis();
            Some((ts, c.get(4)?.as_f64()?))
        })
        .max_by_key(|(ts, _)| *ts)
}

/// Yesterday's close out of a daily candle reply: the newest candle dated before today (IST).
fn close_before(body: &str, today: chrono::NaiveDate) -> Option<f64> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    v["data"]["candles"]
        .as_array()?
        .iter()
        .filter_map(|c| {
            let day = chrono::DateTime::parse_from_rfc3339(c.get(0)?.as_str()?).ok()?.date_naive();
            (day < today).then_some((day, c.get(4)?.as_f64()?))
        })
        .max_by_key(|(d, _)| *d)
        .map(|(_, close)| close)
}

fn ist_today() -> chrono::NaiveDate {
    (chrono::Utc::now() + chrono::Duration::minutes(330)).date_naive()
}

/// The newest daily candle (its stamp and close) and the close of the day before it.
fn last_day(body: &str) -> Option<(i64, f64, Option<f64>)> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let mut days: Vec<(chrono::NaiveDate, i64, f64)> = v["data"]["candles"]
        .as_array()?
        .iter()
        .filter_map(|c| {
            let at = chrono::DateTime::parse_from_rfc3339(c.get(0)?.as_str()?).ok()?;
            Some((at.date_naive(), at.timestamp_millis(), c.get(4)?.as_f64()?))
        })
        .collect();
    days.sort_by_key(|(d, _, _)| *d);
    let (_, ts, close) = *days.last()?;
    let before = days.len().checked_sub(2).map(|i| days[i].2);
    Some((ts, close, before))
}

/// What the daily candles say, asked once a day per instrument: yesterday's close, and the last
/// session's close with the one before it (the price shown before today's first minute candle).
#[derive(Clone, Copy)]
struct Daily {
    prev_close: Option<f64>,
    last: Option<(i64, f64, Option<f64>)>,
}

/// A price from the candle APIs, for what neither quote endpoint serves: the latest minute's close,
/// with yesterday's close from the daily candles. Before today's first minute candle (after midnight
/// IST, over a weekend, on a holiday) the last daily close stands in, as a replay against the close before it.
async fn candle_tick(
    client: &reqwest::Client,
    token: &str,
    key: &str,
    closes: &mut HashMap<String, (chrono::NaiveDate, Daily)>,
) -> Result<Option<Tick>, UErr> {
    let enc = encode_key(key);
    let body = get(client, token, &format!("{BASE}/v3/historical-candle/intraday/{enc}/minutes/1")).await?;
    let today = ist_today();
    if closes.get(key).map(|(d, _)| *d) != Some(today) {
        let from = today - chrono::Duration::days(10);
        let daily = get(client, token, &format!("{BASE}/v3/historical-candle/{enc}/days/1/{today}/{from}")).await.ok();
        let d = Daily {
            prev_close: daily.as_deref().and_then(|b| close_before(b, today)),
            last: daily.as_deref().and_then(last_day),
        };
        closes.insert(key.to_string(), (today, d));
    }
    let daily = closes.get(key).map(|(_, d)| *d).unwrap_or(Daily { prev_close: None, last: None });
    let (ts, ltp, prev_close, replay) = match newest_candle(&body) {
        Some((ts, close)) => (ts, close, daily.prev_close, false),
        None => match daily.last {
            Some((ts, close, before)) => (ts, close, before, true),
            None => return Ok(None),
        },
    };
    Ok(Some(Tick {
        id: InstrumentId(key.replacen('|', ":", 1)),
        ltp,
        volume: None,
        bid: None,
        ask: None,
        oi: None,
        prev_oi: None,
        atp: None,
        prev_close,
        ts_ms: ts,
        src: "upstox",
        replay,
    }))
}

fn reason(e: &UErr) -> String {
    match e {
        UErr::Auth(m) | UErr::Other(m) => m.chars().take(200).collect(),
    }
}

/// The live feed task: holds what is watched, polls Upstox for it, publishes ticks.
pub async fn run_feed(hub: Arc<LiveHub>, mut rx: mpsc::UnboundedReceiver<FeedCmd>, creds: Arc<CredStore>) {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().expect("http client");
    let mut subs: HashSet<InstrumentId> = HashSet::new();
    let mut last: HashMap<InstrumentId, (f64, i64)> = HashMap::new();
    // Keys Upstox said it does not know: left out of later polls so the rest keep working.
    let mut unknown: HashSet<InstrumentId> = HashSet::new();
    // Keys the full quote refuses but LTP V3 serves (Upstox's global indicators): asked there instead.
    let mut ltp_only: HashSet<InstrumentId> = HashSet::new();
    // Keys neither quote endpoint serves but the candle APIs do: priced from the latest minute candle.
    let mut candle_only: HashSet<InstrumentId> = HashSet::new();
    let mut closes: HashMap<String, (chrono::NaiveDate, Daily)> = HashMap::new();
    let mut session = Session { token: None, last_login: None, failures: 0 };
    let mut cred_rx = creds.subscribe();
    let mut before = creds.snapshot(&LOGIN_KEYS);
    let mut timer = tokio::time::interval(POLL);
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    set_status(if can_log_in(&creds) { "ready" } else { NEEDS_CREDS });
    hub.set_feed_status("upstox", false);

    loop {
        tokio::select! {
            cmd = rx.recv() => match cmd {
                Some(FeedCmd::Sub(id)) => {
                    // A new watcher should not wait a whole poll for its first price.
                    let fresh = subs.insert(id);
                    if fresh { timer.reset_immediately(); }
                }
                Some(FeedCmd::Unsub(id)) => { subs.remove(&id); last.remove(&id); }
                None => return,
            },
            changed = cred_rx.changed() => {
                if changed.is_err() { return; }
                let now = creds.snapshot(&LOGIN_KEYS);
                if now != before {
                    before = now;
                    session = Session { token: None, last_login: None, failures: 0 };
                    set_status("credentials changed; logging in again");
                    timer.reset_immediately();
                }
            }
            _ = timer.tick() => {
                if subs.is_empty() { continue; }
                let token = match token(&client, &creds, &mut session).await {
                    Ok(t) => t,
                    Err(e) => { set_status(e); hub.set_feed_status("upstox", false); continue; }
                };
                let id_of = |k: &String| InstrumentId(k.replacen('|', ":", 1));
                let full: Vec<String> = subs.iter().filter(|id| !unknown.contains(*id) && !ltp_only.contains(*id) && !candle_only.contains(*id)).map(upstox_key).collect();
                let mut answer: Result<Vec<String>, UErr> = Ok(Vec::new());
                if !full.is_empty() {
                    let mut first = fetch(&client, &token, FULL, &full).await;
                    if first.as_ref().err().is_some_and(is_unknown_key) {
                        // Find the key(s) the full quote refuses, one call each (a dozen at most, once): LTP V3
                        // may still serve them; what neither knows is left out so the rest keep working.
                        for key in &full {
                            if let Err(e) = fetch(&client, &token, FULL, std::slice::from_ref(key)).await {
                                if !is_unknown_key(&e) { continue; }
                                let by_ltp = fetch(&client, &token, LTP, std::slice::from_ref(key)).await;
                                if by_ltp.is_ok() {
                                    tracing::info!("upstox: {key} is served by LTP V3, not the full quote; asking there");
                                    ltp_only.insert(id_of(key));
                                    continue;
                                }
                                match candle_tick(&client, &token, key, &mut closes).await {
                                    Ok(Some(_)) => {
                                        tracing::info!("upstox: {key} is served by the candle APIs only; pricing it from the latest minute");
                                        candle_only.insert(id_of(key));
                                    }
                                    other => {
                                        let why = match &other { Err(e) => reason(e), _ => "no candles".to_string() };
                                        tracing::warn!(
                                            "upstox: no route serves {key}; leaving it out. full quote: {} | LTP V3: {} | candles: {why}",
                                            reason(&e),
                                            by_ltp.err().map(|e| reason(&e)).unwrap_or_default()
                                        );
                                        unknown.insert(id_of(key));
                                    }
                                }
                            }
                        }
                        let rest: Vec<String> = full.iter().filter(|k| !unknown.contains(&id_of(k)) && !ltp_only.contains(&id_of(k)) && !candle_only.contains(&id_of(k))).cloned().collect();
                        first = if rest.is_empty() { Ok(r#"{"data":{}}"#.to_string()) } else { fetch(&client, &token, FULL, &rest).await };
                    }
                    answer = first.map(|b| vec![b]);
                }
                let ltp: Vec<String> = subs.iter().filter(|id| ltp_only.contains(*id)).map(upstox_key).collect();
                if !ltp.is_empty() {
                    if let Ok(bodies) = answer.as_mut() {
                        match fetch(&client, &token, LTP, &ltp).await {
                            Ok(b) => bodies.push(b),
                            Err(e) => answer = Err(e),
                        }
                    }
                }
                let answer: Result<String, UErr> = answer.and_then(|bodies| {
                    // One list of ticks out of both replies: their `data` maps merged.
                    let mut data = serde_json::Map::new();
                    for b in bodies {
                        if let Ok(serde_json::Value::Object(mut o)) = serde_json::from_str::<serde_json::Value>(&b) {
                            if let Some(serde_json::Value::Object(d)) = o.remove("data") {
                                data.extend(d);
                            }
                        }
                    }
                    Ok(serde_json::json!({ "data": data }).to_string())
                });
                match answer {
                    Ok(body) => match ticks_from(&body, chrono::Utc::now().timestamp_millis()) {
                        Ok(mut ticks) => {
                            for id in subs.iter().filter(|id| candle_only.contains(*id)) {
                                match candle_tick(&client, &token, &upstox_key(id), &mut closes).await {
                                    Ok(Some(t)) => ticks.push(t),
                                    Ok(None) => {}
                                    Err(e) => tracing::debug!("upstox: candles for {}: {}", id.0, reason(&e)),
                                }
                            }
                            hub.set_feed_status("upstox", true);
                            set_status(format!("connected · {} watched · every {} s", subs.len(), POLL.as_secs()));
                            for t in ticks {
                                // Publish only what moved: the slow ones (every 15 min) would otherwise resend the same price.
                                let key = (t.ltp, t.ts_ms);
                                if subs.contains(&t.id) && last.get(&t.id) != Some(&key) {
                                    last.insert(t.id.clone(), key);
                                    hub.publish(&t);
                                }
                            }
                        }
                        Err(e) => { tracing::warn!("upstox: {e}"); set_status(e); }
                    },
                    Err(UErr::Auth(e)) => {
                        hub.set_feed_status("upstox", false);
                        if creds.is_set("UPSTOX_ANALYTICS_TOKEN") {
                            tracing::warn!("upstox: the analytics token was refused ({e}); generate a new one in Upstox's Developer Apps");
                            set_status("analytics token refused: generate a new one in Upstox's Developer Apps");
                        } else {
                            // A daily token (03:30 expiry, or one left in .env by another script): forget it.
                            session.token = None;
                            let _ = creds.set_many(&[("UPSTOX_ACCESS_TOKEN".to_string(), "-".to_string())]);
                            if can_log_in(&creds) {
                                tracing::info!("upstox: the saved daily token has expired; logging in with TOTP");
                                set_status("token expired; logging in again");
                            } else {
                                tracing::warn!("upstox: the saved daily token has expired and there is no way to log in alone; add UPSTOX_ANALYTICS_TOKEN (or UPSTOX_PIN and UPSTOX_TOTP_SECRET) to .env");
                                set_status(NEEDS_CREDS);
                            }
                        }
                    }
                    Err(UErr::Other(e)) => {
                        tracing::warn!("upstox: {e}");
                        hub.set_feed_status("upstox", false);
                        set_status(format!("quote request failed: {e}"));
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_map_to_feed_ids_and_back() {
        let id = feed_id("dji").expect("known");
        assert_eq!(id.0, "GLOBAL_INDEX:^DJI");
        assert_eq!(upstox_key(&id), "GLOBAL_INDEX|^DJI");
        assert_eq!(upstox_key(&feed_id("giftnifty").unwrap()), "GLOBAL_INDEX|SGX NIFTY");
        assert!(feed_id("nope").is_none());
    }

    #[test]
    fn indicator_without_a_price_shows_its_last_close() {
        let body = r#"{"status":"success","data":{"GLOBAL_INDICATOR:USDINR":{"instrument_token":"GLOBAL_INDICATOR|USDINR","last_price":0,"ltq":0,"volume":0,"cp":88.71}}}"#;
        let t = &ticks_from(body, 1).unwrap()[0];
        assert_eq!(t.ltp, 88.71);
        assert!(t.replay);
        assert_eq!(t.prev_close, None);
        let none = r#"{"status":"success","data":{"GLOBAL_INDICATOR:USDINR":{"instrument_token":"GLOBAL_INDICATOR|USDINR","last_price":null,"cp":null}}}"#;
        assert!(ticks_from(none, 1).unwrap().is_empty());
    }

    #[test]
    fn ltp_v3_reply_takes_previous_close_from_cp() {
        let body = r#"{"status":"success","data":{"GLOBAL_INDICATOR:USDINR":{"instrument_token":"GLOBAL_INDICATOR|USDINR","last_price":84.1234,"ltq":0,"volume":0,"cp":84.05}}}"#;
        let t = &ticks_from(body, 7).expect("parsed")[0];
        assert_eq!(t.id.0, "GLOBAL_INDICATOR:USDINR");
        assert_eq!(t.prev_close, Some(84.05));
        assert_eq!(t.ts_ms, 7);
    }

    #[test]
    fn candles_give_the_latest_close_and_yesterdays() {
        let intraday = r#"{"status":"success","data":{"candles":[["2026-11-04T23:41:00+05:30",84.1,84.2,84.0,84.15,0,0],["2026-11-04T23:40:00+05:30",84.0,84.1,83.9,84.05,0,0]]}}"#;
        assert_eq!(newest_candle(intraday).map(|(_, c)| c), Some(84.15));
        let daily = r#"{"status":"success","data":{"candles":[["2026-11-04T00:00:00+05:30",1,1,1,84.2,0,0],["2026-11-03T00:00:00+05:30",1,1,1,83.9,0,0],["2026-11-02T00:00:00+05:30",1,1,1,83.5,0,0]]}}"#;
        let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 4).unwrap();
        assert_eq!(close_before(daily, today), Some(83.9));
    }

    #[test]
    fn keys_are_encoded_with_percent_twenty_for_spaces() {
        assert_eq!(encode_key("GLOBAL_INDEX|SGX NIFTY"), "GLOBAL_INDEX%7CSGX%20NIFTY");
        assert_eq!(encode_key("GLOBAL_INDEX|^DJI"), "GLOBAL_INDEX%7C%5EDJI");
    }

    /// Upstox keys its reply by symbol with a colon; the instrument token (with a pipe) is what identifies it.
    #[test]
    fn quote_reply_becomes_ticks_with_previous_close() {
        let body = r#"{"status":"success","data":{"GLOBAL_INDEX:DOW JONES":{"instrument_token":"GLOBAL_INDEX|^DJI","last_price":47210.5,"net_change":-120.25,"volume":0,"last_trade_time":"1793811000000","ohlc":{"open":1,"high":1,"low":1,"close":1}}}}"#;
        let ticks = ticks_from(body, 5).expect("parsed");
        assert_eq!(ticks.len(), 1);
        let t = &ticks[0];
        assert_eq!(t.id.0, "GLOBAL_INDEX:^DJI");
        assert_eq!(t.ltp, 47210.5);
        assert_eq!(t.prev_close, Some(47330.75));
        assert_eq!(t.volume, None);
        assert_eq!(t.ts_ms, 1_793_811_000_000);
    }
}
