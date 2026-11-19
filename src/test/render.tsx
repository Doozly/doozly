import { render } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { App } from "../App.tsx";
import { AppProvider } from "../state/AppContext.tsx";
import type { Actions } from "../state/actions.ts";
import { testApp } from "./app.ts";

/** The whole app at a path, on a fresh database. `seed` runs before the first render. */
export async function renderApp(path = "/", seed?: (actions: Actions) => void) {
  const t = await testApp();
  seed?.(t.actions);
  const location = memoryLocation({ path, record: true });
  const view = render(
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <Router hook={location.hook}>
        <App />
      </Router>
    </AppProvider>,
  );
  return { ...t, view, at: () => location.history.at(-1) };
}
