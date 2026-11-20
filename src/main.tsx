import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { SessionProvider } from "./app/account/SessionContext.tsx";
import { listenForInstall } from "./app/pwa/install.ts";
import { registerServiceWorker } from "./app/pwa/serviceWorker.ts";
import { openDb } from "./data/db.ts";
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
} else {
  await start(root);
}

async function start(root: HTMLElement) {
  listenForInstall();
  try {
    // A newer tab wants to upgrade the database, so this old one steps aside
    const db = await openDb({ onBlocking: () => location.reload() });
    const app = createApp(db);
    await app.load();
    registerServiceWorker();

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
