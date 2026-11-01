import type { DockviewApi, DockviewGroupPanel } from "dockview";

/**
 * Even rows and columns, gliding (QuantDesk, 2026-10-14, user: "when I split a container or add to a row,
 * everything should adjust by itself, with a nice little animation").
 *
 * Dockview gives a new container half of the one it lands beside and leaves the rest of the row
 * as it was, so a third container in a row came out a quarter, a quarter and a half. Here, after
 * a container is added or removed, every row or column whose number of containers CHANGED shares
 * its space evenly (dockview's own `distributeViewSizes`); rows and columns not touched keep the
 * sizes a hand gave them, and a layout loaded whole (`fromJSON`) is only recorded, never evened.
 *
 * Then the containers glide from where they stood to where they now are — remembered while the
 * desk sits idle (`requestIdleCallback`), since by the time a change is heard dockview has already
 * moved them (it evens a row's direct neighbours itself) — a slide (`transform`)
 * and, for one that grew, a reveal of its new width or height (`clip-path`). Neither changes a
 * container's size frame by frame, so no chart, chain or table lays out more than the once the
 * even split itself costs. Reduced motion: the sizes even out, nothing glides.
 *
 * Dockview keeps its grid internal, so it is reached through `api.component.gridview` (v3.2); if
 * a later version moves it, every step below finds nothing and the dock behaves as before.
 */

interface GridNode {
  children?: GridNode[];
  view?: unknown;
  splitview?: { distributeViewSizes?: () => void };
}

interface DockInternals {
  component?: { gridview?: { root?: GridNode }; _bufferOnDidLayoutChange?: { fire?: () => void } };
}

const GLIDE_MS = 180;
const GLIDE_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function rootOf(api: DockviewApi): GridNode | null {
  return (api as unknown as DockInternals).component?.gridview?.root ?? null;
}

/** Every branch (row or column) of the grid, outermost first. */
function branches(node: GridNode | null, out: GridNode[] = []): GridNode[] {
  if (!node?.children) return out;
  out.push(node);
  for (const child of node.children) branches(child, out);
  return out;
}

function rectsOf(api: DockviewApi): Map<DockviewGroupPanel, DOMRect> {
  return new Map(api.groups.map((group) => [group, group.element.getBoundingClientRect()]));
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Each container from where it stood (`before`) to where it is now. */
function glide(api: DockviewApi, before: Map<DockviewGroupPanel, DOMRect>) {
  if (reducedMotion()) return;
  for (const group of api.groups) {
    const was = before.get(group);
    if (!was) continue;
    const now = group.element.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    // Grown: start clipped to the size it had, so the new width (or height) is revealed.
    const right = Math.max(0, now.width - was.width);
    const bottom = Math.max(0, now.height - was.height);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && right < 1 && bottom < 1) continue;
    group.element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, clipPath: `inset(0px ${right}px ${bottom}px 0px)` },
        { transform: "translate(0px, 0px)", clipPath: "inset(0px 0px 0px 0px)" },
      ],
      { duration: GLIDE_MS, easing: GLIDE_EASE },
    );
  }
}

type Idle = (callback: () => void, options?: { timeout: number }) => number;

/** Starts evening the dock's rows and columns as containers come and go. Returns the stop. */
export function installDockBalance(api: DockviewApi): () => void {
  // Where every container stood when the desk was last quiet: the glide's starting points.
  let settled = new Map<DockviewGroupPanel, DOMRect>();
  let remembering = false;
  const idle: Idle = (window as unknown as { requestIdleCallback?: Idle }).requestIdleCallback ?? ((callback) => window.setTimeout(callback, 200));
  const remember = () => {
    if (remembering) return;
    remembering = true;
    idle(
      () => {
        remembering = false;
        // Never mid-drag: a sash in hand changes sizes every frame, and its end is heard again.
        if (document.documentElement.hasAttribute("data-mh-layout-resizing")) return;
        settled = rectsOf(api);
      },
      { timeout: 1000 },
    );
  };

  // How many containers each row and column held when last seen.
  let counts = new WeakMap<GridNode, number>();
  const record = () => {
    counts = new WeakMap();
    for (const branch of branches(rootOf(api))) counts.set(branch, branch.children!.length);
  };

  const balance = () => {
    const changed = branches(rootOf(api)).filter((branch) => {
      const was = counts.get(branch);
      return was !== undefined && was !== branch.children!.length && branch.children!.length > 1;
    });
    for (const branch of changed) branch.splitview?.distributeViewSizes?.();
    // The saved layout hears of it like any other change (shell/Workspace.tsx saves on it).
    if (changed.length > 0) (api as unknown as DockInternals).component?._bufferOnDidLayoutChange?.fire?.();
    // Every container that was on the desk glides from where it stood; a new one has its own
    // grow-in (Workspace, `.mh-entering`).
    glide(api, settled);
    record();
    remember();
  };

  // After dockview's own event, never inside it: reading sizes in the middle of its add or move
  // forced the whole dock to lay out early (a 105 ms frame, measured 2026-10-13). A zero timeout,
  // so one burst (a split into six) evens out once.
  let queued: ReturnType<typeof setTimeout> | null = null;
  let loading = false;
  const schedule = () => {
    if (queued) return;
    queued = setTimeout(() => {
      queued = null;
      if (loading) {
        loading = false;
        record();
      } else {
        balance();
      }
    }, 0);
  };

  record();
  remember();
  const subscriptions = [
    api.onDidAddGroup(schedule),
    api.onDidRemoveGroup(schedule),
    // A sash dragged, a window resized: where things stand now is the next glide's start.
    api.onDidLayoutChange(remember),
    // A whole layout loaded (a workspace switch, a reset): its sizes are the saved ones.
    api.onDidLayoutFromJSON(() => {
      loading = true;
      schedule();
    }),
  ];
  return () => {
    if (queued) clearTimeout(queued);
    for (const each of subscriptions) each.dispose();
  };
}
