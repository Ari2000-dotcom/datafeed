import { useEffect, useRef, useState, type ReactNode } from "react";

import { fmt0 } from "../core/format";
import { SlidersIcon } from "../ui/icons";
import { Popover } from "../ui/Popover";
import { DEFAULT_VIEW, RANGES, SIDES, SINCE, UNITS, type DeltaOiView } from "./deltaOiView";
import "./deltaOiSettings.css";

/**
 * The scrip chart's Δ × OI view, set the way the Delta × OI panel is: which session's board, how
 * many strikes round the money, and the units, plus which side to draw and how far back the change
 * is read. One icon button on the strip (the view's settings, TradingView's manner) opens it; the
 * popover is `ui/Popover`, so no panel clips it.
 */

export interface SessionOption {
  value: string;
  label: string;
}

/** A row of choices as one segmented control: one pressed, the rest a click away. */
function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: Readonly<{
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  hint?: string;
}>) {
  return (
    <div className="mh-set-row">
      <div className="mh-set-label">{label}</div>
      <div className="mh-set-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className="mh-set-seg-btn" aria-pressed={o.value === value} disabled={disabled} title={o.title} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <div className="mh-set-hint">{hint}</div> : null}
    </div>
  );
}

export function DeltaOiSettings({
  view,
  onChange,
  session,
  sessions,
  onSession,
  lot,
}: Readonly<{
  view: DeltaOiView;
  onChange: (patch: Partial<DeltaOiView>) => void;
  /** "live", or a past day (YYYY-MM-DD). */
  session: string;
  sessions: readonly SessionOption[];
  onSession: (session: string) => void;
  /** The underlying's lot, for the units row. */
  lot: number;
}>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const past = session !== "live";
  const changed = past || (Object.keys(DEFAULT_VIEW) as (keyof DeltaOiView)[]).some((k) => view[k] !== DEFAULT_VIEW[k]);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !box.current?.contains(target)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="mh-dropdown">
      <button
        ref={trigger}
        type="button"
        className="mh-icon-btn mh-set-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Δ × OI settings"
        title={past ? "Δ × OI settings · a past session" : "Δ × OI settings"}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersIcon />
        {changed ? <i className="mh-set-dot" data-tone={past ? "warn" : undefined} aria-hidden /> : null}
      </button>
      {open ? (
        <Popover anchor={trigger} boxRef={box} align="end" className="mh-set">
          <div role="dialog" aria-label="Δ × OI settings">
            <div className="mh-set-head">
              <span>Δ × OI</span>
              <button
                type="button"
                className="mh-set-reset"
                disabled={!changed}
                onClick={() => {
                  onChange(DEFAULT_VIEW);
                  onSession("live");
                }}
              >
                Reset
              </button>
            </div>
            <Seg label="Session" value={session} options={sessions} onChange={onSession} />
            <Seg
              label="Strikes round the money"
              value={view.range}
              options={RANGES.map((r) => ({ value: r, label: r === "all" ? "All" : `±${r}`, title: r === "all" ? "Every strike of the expiry" : `${r * 2 + 1} strikes` }))}
              onChange={(range) => onChange({ range })}
              hint={past && view.range === "all" ? "The whole chain of a day older than the last two sessions is slower to load." : undefined}
            />
            <Seg
              label="Show"
              value={view.sides}
              options={SIDES.map((s) => ({ value: s, label: s === "both" ? "Calls and puts" : s === "call" ? "Calls" : "Puts" }))}
              onChange={(sides) => onChange({ sides })}
            />
            <Seg
              label="Units"
              value={view.unit}
              options={UNITS.map((u) => ({
                value: u,
                label: u === "contracts" ? "Contracts" : `× lot ${fmt0(lot)}`,
                title: u === "contracts" ? "Open interest as the feed counts it" : `Open interest times the lot of ${fmt0(lot)}, in units of the underlying`,
              }))}
              onChange={(unit) => onChange({ unit })}
            />
            <Seg
              label="Change against"
              value={view.since}
              options={SINCE.map((m) => ({ value: m, label: `${m} min` }))}
              onChange={(since) => onChange({ since })}
              disabled={past}
              hint={past ? "A past session's board is one reading: there is no change to show." : undefined}
            />
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
