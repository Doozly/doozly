import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { openDb } from "./data/db.ts";
import { AppProvider } from "./state/AppContext.tsx";
import { createActions } from "./state/actions.ts";
import { createApp } from "./state/store.ts";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing in index.html");

try {
  // A newer tab wants to upgrade the database, so this old one steps aside
  const db = await openDb({ onBlocking: () => location.reload() });
  const app = createApp(db);
  await app.load();

  createRoot(root).render(
    <StrictMode>
      <AppProvider value={{ app, actions: createActions(app) }}>
        <App />
      </AppProvider>
    </StrictMode>,
  );
} catch (err) {
  console.error(err);
  root.textContent =
    "Doozly couldn't open its storage. If you're in a private window, try a normal one.";
}
