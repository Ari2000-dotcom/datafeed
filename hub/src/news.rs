//! Market news for the web app: a pass-through for a fixed list of public RSS feeds
//! (news-feeds.json). Browsers can't read other sites' feeds themselves (no CORS), so the
//! hub fetches one feed per request and hands the XML back untouched; the page parses,
//! groups and tags it. Nothing is kept on this machine: repeat reads are served by the
//! browser's cache (`Cache-Control`), so the hub stays stateless.
//!
//!   GET /news            → the feed list (id, name, region, kind), no URLs
//!   GET /news?id=<id>    → that feed's RSS XML

use axum::extract::Query;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use std::sync::OnceLock;
use std::time::Duration;

static FEEDS_JSON: &str = include_str!("../news-feeds.json");
/// A feed is a few tens of KB; anything this big is not one.
const MAX_FEED_BYTES: usize = 2 * 1024 * 1024;
/// How long a browser may reuse a feed before asking again.
const FEED_CACHE: &str = "public, max-age=90";

#[derive(Deserialize, Clone)]
struct Feed {
    id: String,
    name: String,
    region: String,
    /// markets, policy, macro, global or official: how the page weighs what the feed says.
    #[serde(default)]
    kind: String,
    url: String,
}

fn feeds() -> &'static [Feed] {
    static FEEDS: OnceLock<Vec<Feed>> = OnceLock::new();
    FEEDS.get_or_init(|| serde_json::from_str(FEEDS_JSON).expect("news-feeds.json"))
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent("Mozilla/5.0 (compatible; AlphaHedge news reader)")
            .build()
            .expect("news client")
    })
}

#[derive(Deserialize)]
pub struct NewsQuery {
    id: Option<String>,
}

pub async fn news(Query(q): Query<NewsQuery>) -> Response {
    let Some(id) = q.id else {
        let list: Vec<_> = feeds()
            .iter()
            .map(|f| serde_json::json!({"id": f.id, "name": f.name, "region": f.region, "kind": f.kind}))
            .collect();
        return ([(header::CACHE_CONTROL, "public, max-age=3600")], axum::Json(list)).into_response();
    };
    let Some(feed) = feeds().iter().find(|f| f.id == id) else {
        return (StatusCode::NOT_FOUND, "no such feed").into_response();
    };
    let res = match client().get(&feed.url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return (StatusCode::BAD_GATEWAY, format!("feed answered {}", r.status())).into_response(),
        Err(e) => {
            tracing::debug!(feed = %feed.id, error = %e, "news feed unreachable");
            return (StatusCode::BAD_GATEWAY, "feed unreachable").into_response();
        }
    };
    if res.content_length().is_some_and(|n| n as usize > MAX_FEED_BYTES) {
        return (StatusCode::BAD_GATEWAY, "feed too large").into_response();
    }
    match res.bytes().await {
        Ok(body) if body.len() <= MAX_FEED_BYTES => (
            [(header::CONTENT_TYPE, "application/xml; charset=utf-8"), (header::CACHE_CONTROL, FEED_CACHE)],
            body,
        )
            .into_response(),
        Ok(_) => (StatusCode::BAD_GATEWAY, "feed too large").into_response(),
        Err(_) => (StatusCode::BAD_GATEWAY, "feed unreachable").into_response(),
    }
}
