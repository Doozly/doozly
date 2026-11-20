import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openDb } from "../../data/db.ts";
import { loadTauri } from "../../platform.ts";
import { AppProvider } from "../../state/AppContext.tsx";
import { createActions } from "../../state/actions.ts";
import { createApp } from "../../state/store.ts";
import { QuickAdd } from "./QuickAdd.tsx";

/** The quick add window: just the store and the box. The main window syncs what it adds. */
export async function mountQuickAdd(root: HTMLElement) {
  const db = await openDb({ onBlocking: () => location.reload() });
  const app = createApp(db);
  await app.load();
  const actions = createActions(app);
  const close = () =>
    void loadTauri().then(({ invoke }) => invoke("close_quick_add"));
  createRoot(root).render(
    <StrictMode>
      <AppProvider value={{ app, actions }}>
        <QuickAdd onClose={close} />
      </AppProvider>
    </StrictMode>,
  );
}
