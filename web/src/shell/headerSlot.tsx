import { createContext, useContext, useEffect, useState, useSyncExternalStore, type FunctionComponent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { IDockviewHeaderActionsProps, IDockviewPanelProps } from "dockview";

/*
 * One header line per container. A container holding a single panel has no use for a tab naming
 * it: the panel's own strip (its symbol, its pickers, its readouts) already does, and a tab row
 * over the strip spent 28px of every container saying it twice. So the dock's header keeps a slot
 * (`HeaderSlot`, before the tabs) and the panel's strip (`PanelHeader`) moves into it: one line
 * holds the strip, the header's grip for dragging the container, and its split, maximise and close
 * buttons. A container holding two or more panels, or too narrow for its strip to fit one line,
 * keeps its tabs, and each panel its strip inline.
 */

const slots = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/**
 * Narrower than this, a container's strip does not fit one line beside the header's buttons: it
 * wraps inside the container, under a tab row, as it always has.
 */
const ONE_LINE_MIN = 800;

/** The dock's prefix header action: the slot a single panel's strip lands in. */
export function HeaderSlot({ group, panels }: IDockviewHeaderActionsProps) {
  const [wide, setWide] = useState(() => group.element.clientWidth >= ONE_LINE_MIN);
  useEffect(() => {
    const ro = new ResizeObserver(() => setWide(group.element.clientWidth >= ONE_LINE_MIN));
    ro.observe(group.element);
    return () => ro.disconnect();
  }, [group]);
  const single = panels.length === 1 && wide;
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!single || !element) return;
    slots.set(group.id, element);
    changed();
    return () => {
      if (slots.get(group.id) === element) slots.delete(group.id);
      changed();
    };
  }, [single, element, group.id]);
  return single ? <div ref={setElement} className="mh-header-slot" /> : null;
}

const SlotContext = createContext<HTMLElement | null>(null);

/** Wraps a dock panel so the strip inside it can find its container's header slot. */
export function withHeaderSlot<T extends object>(Panel: FunctionComponent<IDockviewPanelProps<T>>): FunctionComponent<IDockviewPanelProps<T>> {
  function Slotted(props: IDockviewPanelProps<T>) {
    const { api } = props;
    // The container a panel is in changes when it is dragged to another one.
    const [groupId, setGroupId] = useState(api.group.id);
    useEffect(() => {
      setGroupId(api.group.id);
      const subscription = api.onDidGroupChange(() => setGroupId(api.group.id));
      return () => subscription.dispose();
    }, [api]);
    useSyncExternalStore(subscribe, () => version);
    return (
      <SlotContext.Provider value={slots.get(groupId) ?? null}>
        <Panel {...props} />
      </SlotContext.Provider>
    );
  }
  return Slotted;
}

/** A panel's strip: in its container's header when the container holds it alone, else in place. */
export function PanelHeader({ className, children }: Readonly<{ className: string; children: ReactNode }>) {
  const slot = useContext(SlotContext);
  return slot ? createPortal(<div className={`${className} mh-in-header`}>{children}</div>, slot) : <div className={className}>{children}</div>;
}
