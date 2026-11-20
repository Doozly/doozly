import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { SessionProvider } from "./app/account/SessionContext.tsx";
import { openDb } from "./data/db.ts";
import { registerServiceWorker } from "./reminders/push.ts";
import { AppProvider } from "./state/AppContext.tsx";
import { createActions } from "./state/actions.ts";
import { createApp } from "./state/store.ts";
import { createGoogleAuth } from "./sync/google/auth.ts";
import { createMicrosoftAuth } from "./sync/microsoft/auth.ts";
import {
  type AccountAuth,
  createSession,
  type ProviderKind,
} from "./sync/session.ts";
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
  try {
    // A newer tab wants to upgrade the database, so this old one steps aside
    const db = await openDb({ onBlocking: () => location.reload() });
    const app = createApp(db);
    await app.load();

    // A sign-in is only offered when its client ID is set
    const auths: Partial<Record<ProviderKind, AccountAuth>> = {};
    const {
      VITE_GOOGLE_CLIENT_ID: google,
      VITE_MICROSOFT_CLIENT_ID: microsoft,
    } = import.meta.env;
    if (google) {
      auths.google = createGoogleAuth({
        clientId: google,
        relayUrl: import.meta.env.VITE_RELAY_URL,
      });
    }
    if (microsoft) {
      auths.microsoft = createMicrosoftAuth({
        clientId: microsoft,
        relayUrl: import.meta.env.VITE_RELAY_URL,
      });
    }
    const session = createSession({ app, auths });
    void session.start();
    registerServiceWorker();

    createRoot(root).render(
      <StrictMode>
        <AppProvider value={{ app, actions: createActions(app) }}>
          <SessionProvider value={session}>
            <App />
          </SessionProvider>
        </AppProvider>
      </StrictMode>,
    );
  } catch (err) {
    console.error(err);
    root.textContent =
      "Doozly couldn't open its storage. If you're in a private window, try a normal one.";
  }
}
