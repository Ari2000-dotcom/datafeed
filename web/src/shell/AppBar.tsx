import { useEffect, useState, type RefObject } from "react";

import { CANVAS_TONES, type CanvasId } from "../core/canvas";
import { PAGES, type Page } from "../core/route";
import type { Hub, HubStatus } from "../hub/client";
import { Dropdown } from "../ui/Dropdown";
import { FullscreenOffIcon, FullscreenOnIcon, MenuIcon, ToneIcon } from "../ui/icons";
import { Logo } from "../ui/Logo";
import { Ticker } from "./Ticker";

/**
 * The site's top bar, the frame round every page: the menu, the mark, the pages as tabs (the one
 * open underlined in the accent), and what holds for every page at the right: the indices, the
 * feed's state, the canvas tone and fullscreen. It is the chrome's darkest tone, edge to edge, so the
 * plates of the page under it read as the work and the bar as the frame. A page's own controls
 * live in that page (the chart toolbar on Terminal), never here.
 */

const STATUS_TEXT: Record<HubStatus, string> = {
  connecting: "Connecting",
  open: "Live",
  reconnecting: "Reconnecting",
  closed: "Disconnected",
};
const STATUS_TONE: Record<HubStatus, string> = {
  connecting: "mh-busy",
  open: "mh-ok",
  reconnecting: "mh-busy",
  closed: "mh-error",
};

export function AppBar({
  page,
  hub,
  menuButton,
  menuOpen,
  onMenu,
  canvas,
  onCanvas,
  fullscreen,
  onFullscreen,
}: Readonly<{
  page: Page;
  hub: Hub | null;
  menuButton: RefObject<HTMLButtonElement>;
  menuOpen: boolean;
  onMenu: () => void;
  canvas: CanvasId;
  onCanvas: (id: CanvasId) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
}>) {
  const [status, setStatus] = useState<HubStatus>(hub?.state ?? "connecting");
  useEffect(() => (hub ? hub.onStatus(setStatus) : undefined), [hub]);

  return (
    <header className="mh-appbar">
      <button ref={menuButton} type="button" className="mh-appbar-btn" aria-label="Menu" title="Menu" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onMenu}>
        <MenuIcon />
      </button>
      <a className="mh-appbar-brand" href="#/desk" aria-label="AlphaHedge, home">
        <Logo />
        <span className="mh-wordmark">
          Alpha<span className="mh-wordmark-hedge">Hedge</span>
        </span>
      </a>
      <nav className="mh-appnav" aria-label="Pages">
        {PAGES.map((p) => (
          <a key={p.id} className="mh-appnav-item" href={p.href} title={p.title} aria-current={page === p.id ? "page" : undefined}>
            {p.name}
          </a>
        ))}
      </nav>
      <span className="mh-spacer" />
      {hub ? <Ticker hub={hub} /> : null}
      <span className="mh-appbar-sep" aria-hidden />
      {/* On a phone the dot says it alone (styles.css): the word is the first thing the bar can spare. */}
      <span className="mh-feed" title={`${STATUS_TEXT[status]} · the connection to the market data feed`}>
        <span className={`mh-dot ${STATUS_TONE[status]}`} />
        <span className="mh-feed-word">{STATUS_TEXT[status]}</span>
      </span>
      <span className="mh-appbar-sep" aria-hidden />
      <Dropdown
        label="Canvas"
        heading="Canvas"
        icon={<ToneIcon />}
        align="end"
        value={canvas}
        onChange={onCanvas}
        options={CANVAS_TONES.map((tone) => ({
          value: tone.id,
          label: tone.name,
          note: tone.note,
          icon: (
            <span className="mh-swatch-tone" data-canvas={tone.id} aria-hidden>
              <span className="mh-swatch-chrome" />
              <span className="mh-swatch-page" />
              <span className="mh-swatch-row" />
            </span>
          ),
        }))}
      />
      <button
        type="button"
        className="mh-appbar-btn"
        onClick={onFullscreen}
        aria-pressed={fullscreen}
        aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen: hide the browser's own bars"}
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {fullscreen ? <FullscreenOffIcon /> : <FullscreenOnIcon />}
      </button>
    </header>
  );
}
