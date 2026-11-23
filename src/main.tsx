import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, Landing } from "./App.tsx";
import { SessionProvider } from "./app/account/SessionContext.tsx";
import { listenForInstall } from "./app/pwa/install.ts";
import {
  registerServiceWorker,
  watchDesktopUpdates,
} from "./app/pwa/serviceWorker.ts";
import { welcomedBefore } from "./app/welcome/useWelcome.ts";
import { openDb } from "./data/db.ts";
import { isDesktop } from "./platform.ts";
import { AppProvider } from "./state/AppContext.tsx";
import { createActions } from "./state/actions.ts";
import { createApp } from "./state/store.ts";
import type { Session } from "./sync/session.ts";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing in index.html");

if (import.meta.env.DEV && location.pathname === "/dev/sync") {
  const { mountSyncProbe } = await import("./sync/probe.ts");
  mountSyncProbe(root);
} else if (isDesktop() && location.pathname === "/quick-add") {
  const { mountQuickAdd } = await import("./app/desktop/quickAddMain.tsx");
  await mountQuickAdd(root);
} else {
  await start(root);
}

async function start(root: HTMLElement) {
  listenForInstall();
  // Maybe a first visit, then the landing page loads while the database opens
  if (!welcomedBefore() && !isDesktop()) void Landing.preload();
  try {
    // A newer tab wants to upgrade the database, so this old one steps aside
    const db = await openDb({ onBlocking: () => location.reload() });
    const app = createApp(db);
    await app.load();
    registerServiceWorker();
    if (isDesktop()) watchDesktopUpdates();

    const actions = createActions(app);
    const reactRoot = createRoot(root);
    const render = (session: Session | null) =>
      reactRoot.render(
        <StrictMode>
          <AppProvider value={{ app, actions }}>
            <SessionProvider value={session}>
              <App />
            </SessionProvider>
          </AppProvider>
        </StrictMode>,
      );
    render(null);
    // Only a `--features smoke` build of the desktop app sets it, for CI
    if (isDesktop() && "__DOOZLY_SMOKE__" in window) {
      void import("./app/desktop/smoke.ts").then(({ runSmoke }) =>
        runSmoke(app, actions),
      );
    }
    // The tasks are all here already, sign-in and sync can come a moment after
    import("./sync/start.ts").then(
      ({ startSession }) => render(startSession(app)),
      (err) => console.error("Sync couldn't load", err),
    );
  } catch (err) {
    console.error(err);
    root.textContent =
      "Doozly couldn't open its storage. If you're in a private window, try a normal one.";
  }
}
