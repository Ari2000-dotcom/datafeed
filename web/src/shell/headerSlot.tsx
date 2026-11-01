import { createContext, useContext, useSyncExternalStore, type FunctionComponent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { IDockviewPanelProps } from "dockview";

/*
 * One toolbar for the whole desk, TradingView's way. The top toolbar keeps a slot
 * (`ToolbarSlot`), and the chart that is active puts its controls there (`PanelHeader`): its
 * symbol, expiry, session, interval, indicators. The other charts draw no toolbar at all, so a
 * layout of four charts spends one 38px row on controls, not four. Clicking a chart makes it the
 * active one (shell/Workspace.tsx) and the toolbar follows it.
 *
 * A panel outside the chart grid (the bottom panel's table, the side panel's chain) has no panel
 * id and keeps its strip in place.
 */

let slot: HTMLElement | null = null;
let activeId: string | null = null;
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The top toolbar's slot element, as a ref callback. */
export function setToolbarSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  changed();
}

/** The chart the toolbar drives: set by the grid as its active panel changes. */
export function setActivePanel(id: string | null) {
  if (activeId === id) return;
  activeId = id;
  changed();
}

export const useActivePanel = (): string | null => useSyncExternalStore(subscribe, () => activeId);

const PanelId = createContext<string | null>(null);

/** The dock panel id of the chart this code renders inside, or null outside the grid. */
export const usePanelId = () => useContext(PanelId);

/** Wraps a grid panel so its toolbar and its chart know which panel they belong to. */
export function withHeaderSlot<T extends object>(Panel: FunctionComponent<IDockviewPanelProps<T>>): FunctionComponent<IDockviewPanelProps<T>> {
  function Slotted(props: IDockviewPanelProps<T>) {
    return (
      <PanelId.Provider value={props.api.id}>
        <Panel {...props} />
      </PanelId.Provider>
    );
  }
  return Slotted;
}

/**
 * A panel's controls: in the top toolbar while its chart is the active one, nowhere otherwise.
 * `rowRef` reaches the row itself, wherever it is drawn (a measured fit, ui/fitRow.ts).
 */
export function PanelHeader({ className, rowRef, children }: Readonly<{ className: string; rowRef?: (row: HTMLElement | null) => void; children: ReactNode }>) {
  const id = useContext(PanelId);
  useSyncExternalStore(subscribe, () => version);
  if (id === null)
    return (
      <div ref={rowRef} className={className}>
        {children}
      </div>
    );
  if (id !== activeId || !slot) return null;
  return createPortal(
    <div ref={rowRef} className={`${className} mh-in-toolbar`}>
      {children}
    </div>,
    slot,
  );
}
