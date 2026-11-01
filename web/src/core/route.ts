import { useSyncExternalStore } from "react";

/**
 * The site's pages, by the address's hash (`#/charts`, `#/chain`): each is a link, so the
 * browser's back and forward move between them, a page can be bookmarked or opened in a new tab,
 * and no server route is needed (Caddy serves index.html for every path). The app bar lists them in
 * this order; a new page is a row here and a branch in App.tsx.
 */

export type Page = "charts" | "chain";

export const PAGES: readonly { id: Page; name: string; href: string }[] = [
  { id: "charts", name: "Charts", href: "#/charts" },
  { id: "chain", name: "Option chain", href: "#/chain" },
];

const pageOf = (hash: string): Page => PAGES.find((p) => p.href === hash || `#/${p.id}` === hash.replace(/\/$/, ""))?.id ?? "charts";

export const usePage = (): Page =>
  useSyncExternalStore(
    (fn) => {
      window.addEventListener("hashchange", fn);
      return () => window.removeEventListener("hashchange", fn);
    },
    () => pageOf(window.location.hash),
  );
