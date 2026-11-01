import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { forgetLayouts } from "./shell/Workspace";
import { Crash, CrashNote } from "./ui/Crash";
import "dockview/dist/styles/dockview.css";
import "./theme/tokens.css";
import "./styles.css";
import "./theme/dock.css";

// Each panel catches its own crash (shell/Workspace.tsx); this one is for the rest, the title bar
// and the desk itself, which used to leave a blank page.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Crash
      fallback={(error) => (
        <div className="mh-crash-page">
          <CrashNote title="AlphaHedge stopped" error={error}>
            <button type="button" className="mh-btn" onClick={() => location.reload()}>
              Reload
            </button>
            <button
              type="button"
              className="mh-btn"
              onClick={() => {
                forgetLayouts();
                location.reload();
              }}
            >
              Reset the layout and reload
            </button>
          </CrashNote>
        </div>
      )}
    >
      <App />
    </Crash>
  </StrictMode>,
);
