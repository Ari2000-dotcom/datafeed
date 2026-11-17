import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

// The page talks to its own address (/ws, /history). In production Caddy serves the page and passes
// those to the hub; in development Vite does the same. Default target is the VPS hub, since no hub
// runs on this PC; HUB=http://127.0.0.1:8080 points it at a local one.
const hub = process.env.HUB ?? "https://alphahedgedesk.duckdns.org"

interface NewsFeed {
  id: string
  name: string
  region: string
  kind?: string
  url: string
}

/**
 * /news in development: the same pass-through the hub serves (hub/src/news.rs), reading the same
 * feed list (hub/news-feeds.json), so the news panel works before the VPS has the route. Set
 * HUB_NEWS=1 to send /news to the hub instead.
 */
function newsDev(): Plugin {
  const feeds: NewsFeed[] = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../hub/news-feeds.json"), "utf8")
  )
  return {
    name: "news-dev",
    configureServer(server) {
      server.middlewares.use("/news", async (req, res) => {
        const id = new URL(req.url ?? "/", "http://x").searchParams.get("id")
        if (!id) {
          res.setHeader("content-type", "application/json")
          res.end(JSON.stringify(feeds.map(({ id, name, region, kind }) => ({ id, name, region, kind }))))
          return
        }
        const feed = feeds.find((f) => f.id === id)
        if (!feed) {
          res.statusCode = 404
          res.end("no such feed")
          return
        }
        try {
          const r = await fetch(feed.url, {
            headers: { "user-agent": "Mozilla/5.0 (compatible; AlphaHedge news reader)" },
            signal: AbortSignal.timeout(8000),
          })
          if (!r.ok) throw new Error(String(r.status))
          res.setHeader("content-type", "application/xml; charset=utf-8")
          res.setHeader("cache-control", "public, max-age=90")
          res.end(Buffer.from(await r.arrayBuffer()))
        } catch {
          res.statusCode = 502
          res.end("feed unreachable")
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.HUB_NEWS ? [] : [newsDev()])],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(import.meta.dirname, "./src") },
      // Our fork of openalgo-charts, from its TypeScript source (vendor/openalgo-charts/FORK.md).
      { find: /^openalgo-charts$/, replacement: resolve(import.meta.dirname, "./vendor/openalgo-charts/src/index.ts") },
    ],
  },
  server: {
    // Bound to IPv4 so http://127.0.0.1 and http://localhost both open.
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      // changeOrigin + origin: Caddy answers only to its own host name, and the hub lets browsers open /ws only from its own site.
      "/ws": { target: hub.replace(/^http/, "ws"), ws: true, changeOrigin: true, headers: { origin: hub } },
      "/history": { target: hub, changeOrigin: true },
      "/straddle_history": { target: hub, changeOrigin: true },
      ...(process.env.HUB_NEWS ? { "/news": { target: hub, changeOrigin: true } } : {}),
    },
  },
})
