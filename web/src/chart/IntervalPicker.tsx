import { Fragment, useEffect, useId, useRef, useState } from "react";

import { CheckIcon, ChevronDownIcon } from "../ui/icons";
import { useTypeahead } from "../ui/menuSearch";
import { Popover } from "../ui/Popover";
import { CANDLE_INTERVALS } from "./useCandles";

const OPTIONS = CANDLE_INTERVALS.map((c) => ({ value: c.value, label: c.name }));

/**
 * The interval as one button on the strip, TradingView's interval menu: the current interval
 * ("5m", "1h", "1D") and a chevron, opening every interval by minutes, hours and days. One button
 * whatever the interval, so the strip keeps its width and everything else on it stays in view.
 *
 * In the menu ↑/↓, Home/End move, Enter picks, a digit or a letter jumps to it, and Escape, Tab or
 * a click outside closes.
 */
export function IntervalPicker({ value, onChange }: Readonly<{ value: string; onChange: (value: string) => void }>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = CANDLE_INTERVALS.find((c) => c.value === value);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (index: number) => {
    const c = CANDLE_INTERVALS[index];
    if (c) onChange(c.value);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !box.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const typeahead = useTypeahead(OPTIONS, active, setActive);
  const onKey = (e: React.KeyboardEvent) => {
    const last = CANDLE_INTERVALS.length - 1;
    const moves: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => pick(active),
      " ": () => pick(active),
      Escape: () => close(true),
      Tab: () => close(false),
    };
    const move = moves[e.key];
    if (!move) {
      if (typeahead(e)) e.preventDefault();
      return;
    }
    if (e.key !== "Tab") e.preventDefault();
    move();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="mh-interval-trigger"
        aria-label={`Interval: ${current?.name ?? value}`}
        title="Interval"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) close(false);
          else {
            setActive(Math.max(0, CANDLE_INTERVALS.findIndex((c) => c.value === value)));
            setOpen(true);
          }
        }}
      >
        {current?.label ?? value}
        <ChevronDownIcon size={11} />
      </button>
      {open ? (
        <Popover anchor={trigger} boxRef={box}>
          <ul
            ref={list}
            id={id}
            role="listbox"
            tabIndex={-1}
            aria-label="Interval"
            aria-activedescendant={`${id}-${active}`}
            className="mh-menu-list"
            onKeyDown={onKey}
          >
            {CANDLE_INTERVALS.map((c, i) => (
              <Fragment key={c.value}>
                {c.group !== CANDLE_INTERVALS[i - 1]?.group ? (
                  <li role="presentation" className="mh-menu-group">
                    {c.group}
                  </li>
                ) : null}
                <li
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={c.value === value}
                  className={i === active ? "mh-menu-item mh-active" : "mh-menu-item"}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                >
                  <span className="mh-menu-text">{c.name}</span>
                  <span className="mh-menu-tick" aria-hidden>
                    {c.value === value ? <CheckIcon size={14} /> : null}
                  </span>
                </li>
              </Fragment>
            ))}
          </ul>
        </Popover>
      ) : null}
    </>
  );
}
