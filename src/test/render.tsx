import { render } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { App } from "../App.tsx";
import { SessionProvider } from "../app/account/SessionContext.tsx";
import { AppProvider } from "../state/AppContext.tsx";
import type { Actions } from "../state/actions.ts";
import type { App as AppStore } from "../state/store.ts";
import type { Session } from "../sync/session.ts";
import { testApp } from "./app.ts";

/** The whole app at a path, on a fresh database. `seed` runs before the first render. */
export async function renderApp(
  path = "/",
  seed?: (actions: Actions) => void,
  withSession?: (app: AppStore) => Session,
) {
  const t = await testApp();
  seed?.(t.actions);
  const session = withSession?.(t.app) ?? null;
  const location = memoryLocation({ path, record: true });
  const view = render(
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <SessionProvider value={session}>
        <Router hook={location.hook}>
          <App />
        </Router>
      </SessionProvider>
    </AppProvider>,
  );
  return { ...t, session, view, at: () => location.history.at(-1) };
}
