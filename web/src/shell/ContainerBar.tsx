import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from "dockview";

import { BarPlusIcon, CheckIcon, KindIcon, MaximizeIcon, MoreIcon, RestoreIcon, SplitColumnsIcon, SplitRowsIcon, TabCloseIcon } from "../ui/icons";
import { Popover } from "../ui/Popover";
import { CHART_KINDS, dockKind, MOST_CELLS, replaceChart, splitCell, type ChartKind } from "./Workspace";
import "./containerBar.css";

/**
 * A container's bar, QuantDesk's (shell/DeskTab.tsx, HeaderAdd.tsx and components/SplitControl.tsx
 * there) on this desk's cells.
 *
 * Drawn as QuantDesk draws it (measured off its desk: 22px buttons, lucide's marks at 14, 16, 13 and
 * 11 with a 2 or 1.75 stroke, the strip washed where it is empty while pointed at):
 *
 *   - the tab names the container with its kind's mark, and a small close button that shows only
 *     while the tab is pointed at (a middle click closes too);
 *   - "+", a round button right after the last tab, fades in while the strip is pointed at and adds
 *     a container beside this one or below it, of any kind (`AddContainer`, QuantDesk's HeaderAdd);
 *   - "⋯", at the strip's right end, holds this container's own actions under one roof: what it
 *     shows (any kind, in place), fill the desk with it (Ctrl Shift M) and back, close it, and
 *     split it into 2 to 4 copies of itself in rows or columns (QuantDesk's SplitControl).
 *
 * A cell is one chart, so the menus add containers, never tabs; the desk holds four at most (the
 * layouts of the picker), and what would go past that is greyed with the reason said.
 */

/* -- the tab ------------------------------------------------------------------------------------ */

export function DeskTab({ api }: Readonly<IDockviewPanelHeaderProps>) {
  const [title, setTitle] = useState(api.title ?? "");
  useEffect(() => {
    setTitle(api.title ?? "");
    const subscription = api.onDidTitleChange((event) => setTitle(event.title));
    return () => subscription.dispose();
  }, [api]);

  // A middle click closes, as on dockview's own tab and in a browser.
  const middle = useRef(false);
  const close = (event: MouseEvent | PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    api.close();
  };

  return (
    <div
      className="mh-tab"
      title={title}
      onPointerDown={(event) => {
        middle.current = event.button === 1;
      }}
      onPointerUp={(event) => {
        if (middle.current && event.button === 1) close(event);
        middle.current = false;
      }}
      onPointerLeave={() => {
        middle.current = false;
      }}
    >
      <span className="mh-tab-icon">
        <KindIcon kind={api.component} />
      </span>
      <span className="mh-tab-title">{title}</span>
      <button
        type="button"
        className="mh-tab-close"
        aria-label={`Close ${title}`}
        // Never the start of a drag or a tab switch.
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={close}
      >
        <TabCloseIcon />
      </button>
    </div>
  );
}

/* -- a menu's open state ------------------------------------------------------------------------ */

/** Open and shut, the trigger and the floating box, with Escape and a press outside to close. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const away = (e: globalThis.PointerEvent) => {
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
  return { open, setOpen, trigger, box };
}

/** A menu's row: a button the menu's own width, its mark first, its note last. */
function Row({
  icon,
  label,
  note,
  title,
  checked,
  disabled,
  onClick,
}: Readonly<{ icon?: ReactNode; label: string; note?: string; title?: string; checked?: boolean; disabled?: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className="mh-menu-item mh-menu-btn"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <span className="mh-menu-icon">{icon}</span> : null}
      <span className="mh-menu-text">{label}</span>
      {note ? <span className="mh-menu-note">{note}</span> : null}
      {/* The pick of a pick-one list: the accent's tick at the row's end, as every other menu draws it. */}
      {checked === undefined ? null : (
        <span className="mh-menu-tick" aria-hidden>
          {checked ? <CheckIcon size={14} /> : null}
        </span>
      )}
    </button>
  );
}

/** A trigger on the bar: it must not also select or start dragging the container under it. */
function BarButton({
  label,
  open,
  trigger,
  onToggle,
  round,
  children,
}: Readonly<{ label: string; open: boolean; trigger: RefObject<HTMLButtonElement>; onToggle: () => void; round?: boolean; children: ReactNode }>) {
  return (
    <button
      ref={trigger}
      type="button"
      className="mh-bar-btn"
      data-round={round || undefined}
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {children}
    </button>
  );
}

/* -- the "+" after the tabs ------------------------------------------------------------------- */

/** Dockview's left-actions slot, which sits right after the last tab: QuantDesk puts its "+" here. */
export function AddContainer({ containerApi, group }: Readonly<IDockviewHeaderActionsProps>) {
  const add = useMenu();
  const [side, setSide] = useState<"right" | "bottom">("right");
  const full = containerApi.groups.length >= MOST_CELLS;

  const addKind = (next: ChartKind) => {
    add.setOpen(false);
    dockKind(containerApi, next, side, group);
  };

  return (
    <div className="mh-bar-add" data-open={add.open || undefined}>
      <BarButton label="Add a container" round open={add.open} trigger={add.trigger} onToggle={() => add.setOpen((o) => !o)}>
        <BarPlusIcon />
      </BarButton>
      {add.open ? (
        <Popover anchor={add.trigger} boxRef={add.box} align="start" className="mh-bar-menu">
          <div role="menu" aria-label="Add a container">
            <div className="mh-bar-where" role="group" aria-label="Where it opens">
              {(
                [
                  ["right", "Beside", <SplitColumnsIcon key="r" />],
                  ["bottom", "Below", <SplitRowsIcon key="b" />],
                ] as const
              ).map(([where, name, icon]) => (
                <button key={where} type="button" className="mh-bar-where-btn" aria-pressed={side === where} onClick={() => setSide(where)}>
                  {icon}
                  {name}
                </button>
              ))}
            </div>
            {CHART_KINDS.map((k) => (
              <Row key={k.kind} icon={<KindIcon kind={k.kind} size={14} />} label={k.name} title={k.note} disabled={full} onClick={() => addKind(k.kind)} />
            ))}
            {full ? <div className="mh-bar-hint">The desk holds {MOST_CELLS} containers. Close one to add another.</div> : null}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/* -- the "⋯" at the bar's right end ------------------------------------------------------------- */

export function ContainerActions({ containerApi, group, activePanel }: Readonly<IDockviewHeaderActionsProps>) {
  const more = useMenu();
  // Filling the desk changes what the menu offers; the group's own API says when.
  const [, bump] = useState(0);
  useEffect(() => {
    const subscription = containerApi.onDidMaximizedGroupChange(() => bump((n) => n + 1));
    return () => subscription.dispose();
  }, [containerApi]);

  if (!activePanel) return null;
  const kind = activePanel.api.component;
  const maximized = group.api.isMaximized();
  const room = MOST_CELLS - containerApi.groups.length;

  const split = (count: number, direction: "below" | "right") => {
    more.setOpen(false);
    splitCell(containerApi, activePanel.id, count, direction);
  };

  return (
    <div className="mh-bar-more">
      <BarButton label="Container actions" open={more.open} trigger={more.trigger} onToggle={() => more.setOpen((o) => !o)}>
        <MoreIcon />
      </BarButton>
      {more.open ? (
        <Popover anchor={more.trigger} boxRef={more.box} align="end" className="mh-bar-menu">
          <div role="menu" aria-label="Container actions">
            <div className="mh-bar-head">Show</div>
            {CHART_KINDS.map((k) => (
              <Row
                key={k.kind}
                icon={<KindIcon kind={k.kind} size={14} />}
                label={k.name}
                title={k.note}
                checked={k.kind === kind}
                onClick={() => {
                  more.setOpen(false);
                  if (k.kind !== kind) replaceChart(containerApi, activePanel.id, k.kind);
                }}
              />
            ))}

            <div className="mh-menu-rule" role="separator" />
            <div className="mh-bar-head">Container</div>
            <Row
              icon={maximized ? <RestoreIcon /> : <MaximizeIcon />}
              label={maximized ? "Back to the whole desk" : "Fill the desk"}
              note="Ctrl Shift M"
              onClick={() => {
                more.setOpen(false);
                if (maximized) group.api.exitMaximized();
                else containerApi.maximizeGroup(activePanel);
              }}
            />
            <Row
              icon={<TabCloseIcon size={14} />}
              label="Close this container"
              onClick={() => {
                more.setOpen(false);
                activePanel.api.close();
              }}
            />

            <div className="mh-menu-rule" role="separator" />
            <div className="mh-bar-head">Split this container</div>
            {(
              [
                ["Rows", <SplitRowsIcon key="r" />, "below"],
                ["Columns", <SplitColumnsIcon key="c" />, "right"],
              ] as const
            ).map(([name, icon, direction]) => (
              <div className="mh-bar-split" key={name}>
                <span className="mh-menu-icon">{icon}</span>
                <span className="mh-menu-text">{name}</span>
                <span className="mh-bar-keys" role="group" aria-label={`${name} to split into`}>
                  {[2, 3, 4].map((count) => (
                    <button
                      key={count}
                      type="button"
                      className="mh-bar-count"
                      disabled={count - 1 > room}
                      title={count - 1 > room ? `The desk holds ${MOST_CELLS} containers` : `Split into ${count} ${name.toLowerCase()}`}
                      onClick={() => split(count, direction)}
                    >
                      {count}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
