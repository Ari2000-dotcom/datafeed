import { useEffect, useRef, useState } from "react";

import { fmt0, fmt2 } from "../core/format";
import { ChevronDownIcon, CloseIcon, PlusIcon } from "../ui/icons";
import { Popover } from "../ui/Popover";
import type { LegendPick } from "./StraddleLegend";

/**
 * The straddles on the chart, in one small box on the strip: the ATM straddle's colour and strike,
 * and a count of the strikes added beside it. Its premium and move are the strip's Straddle
 * readout, right after it, so the box does not say them twice and leaves the room to the
 * underlying's readouts. The box opens a menu of every straddle on the chart with its premium and
 * move, each removable, with "Add straddle" at its foot, so five straddles take the strip no more
 * room than one.
 */
export function StraddleBox({
  colour,
  strike,
  rolled = false,
  value,
  first,
  picks,
  max,
  onRemove,
}: Readonly<{
  colour: string;
  strike: number | null;
  /** The ATM strike moved to a new one at this minute. */
  rolled?: boolean;
  value: number | null;
  first: number | null;
  picks: readonly LegendPick[];
  max: number;
  onRemove: (strike: number) => void;
}>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !box.current?.contains(target)) setOpen(false);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", keys);
    };
  }, [open]);

  const count = 1 + picks.length;
  const add = () => {
    setOpen(false);
    window.dispatchEvent(new Event("mh-add-straddle"));
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="mh-chipbox mh-straddle-box"
        data-main
        aria-haspopup="menu"
        aria-expanded={open}
        title={rolled ? "Straddles on the chart (the ATM strike rolled at this minute)" : "Straddles on the chart"}
        onClick={() => setOpen((o) => !o)}
      >
        <i style={{ background: colour }} />
        <span className="mh-chipbox-name">{strike !== null ? fmt0(strike) : "ATM"}</span>
        <em>ATM</em>
        {picks.length > 0 ? <span className="mh-straddle-box-count">+{picks.length}</span> : null}
        <ChevronDownIcon size={13} />
      </button>

      {open ? (
        <Popover anchor={trigger} boxRef={box} className="mh-straddle-menu">
          <div className="mh-straddle-menu-head">Straddles on the chart</div>
          <ul className="mh-menu-list" role="menu" aria-label="Straddles on the chart">
            <li className="mh-straddle-row" role="presentation">
              <i style={{ background: colour }} />
              <span className="mh-straddle-row-name">{strike !== null ? fmt0(strike) : "—"}</span>
              <em>ATM</em>
              <span className="mh-straddle-row-value" style={{ color: colour }}>
                {value !== null ? fmt2(value) : "—"}
              </span>
              <Move value={value} from={first} />
            </li>
            {picks.map((p) => (
              <li key={p.strike} className="mh-straddle-row" role="presentation">
                <i style={{ background: p.colour }} />
                <span className="mh-straddle-row-name">{fmt0(p.strike)}</span>
                <span className="mh-straddle-row-value" style={{ color: p.colour }}>
                  {p.value !== null ? fmt2(p.value) : "—"}
                </span>
                <Move value={p.value} from={p.first} />
                <button type="button" role="menuitem" className="mh-straddle-row-x" aria-label={`Remove the ${p.strike} straddle`} title="Remove" onClick={() => onRemove(p.strike)}>
                  <CloseIcon size={12} />
                </button>
              </li>
            ))}
            <li role="separator" className="mh-menu-rule" />
            <li role="presentation">
              <button type="button" role="menuitem" className="mh-menu-item mh-straddle-add" disabled={count >= max} onClick={add}>
                <PlusIcon size={12} />
                <span className="mh-menu-text">Add straddle</span>
                <span className="mh-menu-note">
                  {count}/{max}
                </span>
              </button>
            </li>
          </ul>
        </Popover>
      ) : null}
    </>
  );
}

/** The move since the session's open as a percent, green up and red down. */
function Move({ value, from }: Readonly<{ value: number | null; from: number | null }>) {
  if (value === null || from === null || from === 0 || value === from) return null;
  const pct = ((value - from) / from) * 100;
  return (
    <span className={`mh-chip-move ${pct > 0 ? "mh-up" : "mh-down"}`}>
      {pct > 0 ? "+" : "−"}
      {Math.abs(pct).toFixed(2)}%
    </span>
  );
}
