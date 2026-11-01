import { useMemo, type ReactNode } from "react";

import { nearestExpiry } from "../core/format";
import { useUniverse } from "../core/universe";
import type { Hub } from "../hub/client";
import { daysTo, shortDate } from "../option/PickStrip";
import { PanelHeader } from "../shell/headerSlot";
import type { Pick } from "../straddle/StraddlePage";
import { Dropdown } from "../ui/Dropdown";
import { useFitRow } from "../ui/fitRow";

/**
 * The Delta × OI panel's strip: what it is about, and nothing else. The underlying and its expiry
 * here (both pick-one menus, as the scrip chart's strip has them), and after them whatever the
 * panel hands in: the day (today, or a past session) and the band. No search box and no price: the
 * figures under it say where the market is, and an underlying outside the list comes from the
 * charts' own pick, which this panel follows until it is given one of its own.
 *
 * The row gives way piece by piece rather than clipping (`useFitRow`): the day's "closed" and the
 * expiry's days to go first, the exchange badge last.
 */

export function DeltaOiStrip({
  hub,
  pick,
  onPick,
  children,
}: Readonly<{ hub: Hub; pick: Pick | null; onPick: (pick: Pick) => void; children?: ReactNode }>) {
  const universe = useUniverse(hub);
  const fit = useFitRow();
  const options = useMemo(() => {
    const list = universe.map((u) => ({ value: u.id, label: u.name, note: u.id.split(":")[0]!.toUpperCase() }));
    // A pick made elsewhere may not be in the list: it is still the one showing.
    if (pick && !list.some((o) => o.value === pick.underlying.id)) {
      list.unshift({ value: pick.underlying.id, label: pick.underlying.name, note: pick.underlying.id.split(":")[0]!.toUpperCase() });
    }
    return list;
  }, [universe, pick]);

  const choose = (id: string) => {
    const u = universe.find((x) => x.id === id);
    if (u) onPick({ underlying: u, expiry: nearestExpiry(u.expiries), day: "live" });
  };

  return (
    <PanelHeader className="mh-strip mh-tv-strip mh-doi-strip" rowRef={fit}>
      <Dropdown
        label="Underlying"
        caption={false}
        value={pick?.underlying.id ?? ""}
        onChange={choose}
        renderValue={(o) =>
          o ? (
            <>
              <span className="mh-symbol">{o.label}</span> <span className="mh-chip" data-drop={3}>{o.note}</span>
            </>
          ) : (
            "Pick an underlying"
          )
        }
        options={options}
      />
      {pick ? (
        <Dropdown
          label="Expiry"
          caption={false}
          value={pick.expiry}
          onChange={(expiry) => onPick({ ...pick, expiry })}
          renderValue={() => (
            <>
              {shortDate(pick.expiry)} <span className="mh-picker-aside" data-drop={2}>{daysTo(pick.expiry)}</span>
            </>
          )}
          options={pick.underlying.expiries.map((e) => ({ value: e, label: shortDate(e), note: daysTo(e) }))}
        />
      ) : null}
      {children}
    </PanelHeader>
  );
}
