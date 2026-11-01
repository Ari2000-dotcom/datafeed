import { useSyncExternalStore } from "react";

/**
 * The site's pages, by the address's hash (`#/desk`, `#/terminal`): each is a link, so the
 * browser's back and forward move between them, a page can be bookmarked or opened in a new tab,
 * and no server route is needed (Caddy serves index.html for every path). The app bar lists them in
 * this order; a new page is a row here and a branch in App.tsx.
 *
 * **Desk** is where the site opens: one board, laid out for us, that needs no arranging — the ATM
 * straddle large with the scrip chart and Delta × OI beside it, under a line of live figures.
 * **Terminal** is the same instruments with the layout in the reader's hands: containers to add,
 * move, split and swap. Desk is for watching, Terminal for working.
 */

export type Page = "desk" | "terminal" | "chain";

export const PAGES: readonly { id: Page; name: string; href: string; title: string }[] = [
  { id: "desk", name: "Desk", href: "#/desk", title: "The live board: the ATM straddle, the scrip chart and Delta × OI" },
  { id: "terminal", name: "Terminal", href: "#/terminal", title: "Your own layout: containers to add, move, split and swap" },
  { id: "chain", name: "Option chain", href: "#/chain", title: "The chain wide, with Delta × OI beside it" },
];

/** What a page used to be called, so a link or bookmark made before still lands on it. */
const FORMER: Readonly<Record<string, Page>> = { "#/charts": "terminal" };

function pageOf(hash: string): Page {
  const clean = hash.replace(/\/$/, "");
  return PAGES.find((p) => p.href === clean || `#/${p.id}` === clean)?.id ?? FORMER[clean] ?? "desk";
}

export const usePage = (): Page =>
  useSyncExternalStore(
    (fn) => {
      window.addEventListener("hashchange", fn);
      return () => window.removeEventListener("hashchange", fn);
    },
    () => pageOf(window.location.hash),
  );
