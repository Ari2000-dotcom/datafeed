import { DeltaOiPanel } from "../greeks/DeltaOiPanel";
import type { Hub } from "../hub/client";
import { ScripPage } from "../chart/ScripPage";
import { readPick, StraddlePage } from "../straddle/StraddlePage";
import { LiveBar } from "./LiveBar";
import "./deskpage.css";

/**
 * The Desk: where the site opens, one board already laid out.
 *
 * The ATM straddle holds the left, large, because it is what the desk is for; the scrip chart and
 * Delta × OI stack at the right, each half its height, because they are read against it — the
 * straddle moves, and these two say why. Over all three, the live figures (`LiveBar`).
 *
 * Every panel is the same one the Terminal arranges, so what is learned here holds there: the
 * straddle's pickers, the scrip chart's indicators and OI profile, the Delta × OI settings. The
 * three follow one pick — the straddle's — since that is what a board means: one underlying, read
 * three ways. Change it on the straddle and the others come with it.
 *
 * Nothing here is arranged by hand. A reader who wants their own layout goes to the Terminal
 * (`core/route.ts`), which is the same instruments with the containers in their hands.
 */
export function DeskPage({ hub, themeKey }: Readonly<{ hub: Hub; themeKey: string }>) {
  // The underlying the site last had, so the board opens on something rather than on nothing. From
  // there the scrip chart and Delta × OI follow the straddle until their own pickers are used.
  const pick = readPick();

  return (
    <main className="mh-deskpage">
      <LiveBar />
      <div className="mh-deskpage-board">
        <section className="mh-plate mh-deskpage-cell mh-deskpage-main" aria-label="ATM straddle">
          <StraddlePage hub={hub} themeKey={themeKey} />
        </section>
        <section className="mh-plate mh-deskpage-cell" aria-label="Scrip chart">
          <ScripPage hub={hub} themeKey={themeKey} initialId={pick?.underlying.id ?? null} follow />
        </section>
        <section className="mh-plate mh-deskpage-cell" aria-label="Delta × OI">
          {/* No initialPick, so it follows the straddle (useFollowedPick) until its own picker is used. */}
          <DeltaOiPanel hub={hub} />
        </section>
      </div>
    </main>
  );
}
