import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The page talks to its own address (/ws, /history). In production Caddy serves the page and passes
// those to the hub; in development Vite does the same. Default target is the VPS hub, since no hub
// runs on this PC; HUB=http://127.0.0.1:8080 points it at a local one.
const hub = process.env.HUB ?? "https://alphahedgedesk.duckdns.org"

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    },
  },
})
