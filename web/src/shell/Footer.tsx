import { useEffect, useState } from "react";

import { DetailsPanel, TablePanel } from "../desk/panels";
import type { Hub } from "../hub/client";
import { edgeDrag, edgeKeys } from "../ui/edgeDrag";
import { CloseThinIcon } from "../ui/icons";

/**
 * The foot of the chart column, TradingView's bottom bar: tabs on the left that open a panel above
 * it (every straddle on the desk in one table, the ATM straddle's details), a second click shuts
 * it; on the right the time in India (the indices and the feed's state are the app bar's). The
 * panel's top edge drags it taller or shorter.
 */

export type BottomId = "table" | "details";

export const BOTTOM_ITEMS: readonly { id: BottomId; name: string }[] = [
  { id: "table", name: "All straddles" },
  { id: "details", name: "ATM straddle" },
];

export const BOTTOM_MIN = 120;
export const BOTTOM_DEFAULT = 240;

const IST_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** The time in India to the second, as TradingView keeps the exchange's clock in its bottom bar. */
function Clock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="mh-clock" title="India Standard Time">
      {IST_TIME.format(now)} <span className="mh-clock-zone">UTC+5:30</span>
    </span>
  );
}

export function Footer({ open, onToggle, onClose }: Readonly<{ open: BottomId | null; onToggle: (id: BottomId) => void; onClose: () => void }>) {
  const openName = BOTTOM_ITEMS.find((b) => b.id === open)?.name;
  return (
    <footer className="mh-footer mh-plate">
      <div className="mh-footer-tabs" role="toolbar" aria-label="Bottom panels">
        {BOTTOM_ITEMS.map(({ id, name }) => (
          <button key={id} type="button" className="mh-footer-tab" aria-pressed={open === id} onClick={() => onToggle(id)}>
            {name}
          </button>
        ))}
        {openName ? (
          <button type="button" className="mh-panel-close" aria-label={`Close ${openName}`} title="Close the panel" onClick={onClose}>
            <CloseThinIcon />
          </button>
        ) : null}
      </div>
      <span className="mh-spacer" />
      <Clock />
    </footer>
  );
}

export function BottomPanel({
  id,
  hub,
  height,
  maxHeight,
  onHeight,
}: Readonly<{ id: BottomId; hub: Hub; height: number; maxHeight: number; onHeight: (height: number) => void }>) {
  const name = BOTTOM_ITEMS.find((b) => b.id === id)?.name ?? "";
  const shown = Math.min(height, maxHeight);
  return (
    <section className="mh-bottom mh-plate" style={{ height: shown }} aria-label={name}>
      <div
        className="mh-bottom-grip"
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={`Resize the ${name.toLowerCase()} panel`}
        aria-valuenow={shown}
        aria-valuemin={BOTTOM_MIN}
        aria-valuemax={maxHeight}
        onPointerDown={(e) => edgeDrag(e, "y", -1, shown, BOTTOM_MIN, maxHeight, onHeight)}
        onKeyDown={(e) => edgeKeys(e, "y", -1, shown, BOTTOM_MIN, maxHeight, onHeight)}
      />
      <div className="mh-bottom-body">{id === "table" ? <TablePanel /> : <DetailsPanel hub={hub} />}</div>
    </section>
  );
}
