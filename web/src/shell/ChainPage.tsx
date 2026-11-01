import type { Hub } from "../hub/client";
import { DeltaOiPanel } from "../greeks/DeltaOiPanel";
import { ChainPanel } from "../option/ChainPanel";
import { readPick } from "../straddle/StraddlePage";

/**
 * The Option chain page: the chain wide on the left, every column it has (IV included), and Delta ×
 * OI beside it on the same pick, two plates on the workspace tone with the desk's gutter. Both open
 * on the last pick made on a chart and follow it (`useFollowedPick`); the chain's "+" still puts a
 * straddle on the charts for the Charts page.
 */
export function ChainPage({ hub }: Readonly<{ hub: Hub }>) {
  return (
    <main className="mh-chainpage">
      <section className="mh-plate mh-chainpage-pane" aria-label="Option chain">
        <ChainPanel hub={hub} initialPick={readPick()} />
      </section>
      <section className="mh-plate mh-chainpage-pane" aria-label="Delta × OI">
        <DeltaOiPanel hub={hub} initialPick={readPick()} />
      </section>
    </main>
  );
}
