import { INBOX_ID } from "../../data/model.ts";
import { loadTauri } from "../../platform.ts";
import type { createActions } from "../../state/actions.ts";
import type { App } from "../../state/store.ts";

// The CI self-test of a `--features smoke` build, see src-tauri/src/smoke.rs. It runs in the
// real webview of each system and reports to Rust, which exits with the result.

type Check = [name: string, run: () => Promise<boolean> | boolean];

const until = async (ok: () => boolean, ms = 20_000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

/** The task titles as stored, straight from IndexedDB like a restart would read them */
const storedTitles = () =>
  new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open("doozly");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const read = open.result
        .transaction("tasks")
        .objectStore("tasks")
        .getAll();
      read.onsuccess = () => {
        resolve((read.result as { title: string }[]).map((t) => t.title));
        open.result.close();
      };
      read.onerror = () => reject(read.error);
    };
  });

export async function runSmoke(
  app: App,
  actions: ReturnType<typeof createActions>,
) {
  const { invoke } = await loadTauri();
  const title = `Smoke ${Date.now()}`;
  const checks: Check[] = [
    [
      "the app opens on My Day",
      () => until(() => document.title === "My Day - Doozly"),
    ],
    [
      "the CSS the app relies on",
      () =>
        CSS.supports("color", "color-mix(in oklab, red, transparent 50%)") &&
        CSS.supports("selector(:has(*))") &&
        CSS.supports("selector(&)"),
    ],
    [
      "no service worker",
      async () =>
        !("serviceWorker" in navigator) ||
        (await navigator.serviceWorker.getRegistrations()).length === 0,
    ],
    [
      "a new task is stored in IndexedDB",
      async () => {
        actions.addTask(INBOX_ID, title);
        await app.flush();
        return (await storedTitles()).includes(title);
      },
    ],
    [
      "localStorage keeps a value",
      () => {
        localStorage.setItem("doozly.smoke", "1");
        return localStorage.getItem("doozly.smoke") === "1";
      },
    ],
    [
      "Web Crypto for sign-in and reminders",
      async () =>
        (await crypto.subtle.digest("SHA-256", new Uint8Array(1)))
          .byteLength === 32,
    ],
    [
      "Rust answers over IPC",
      async () =>
        typeof (await invoke<{ closeToTray?: unknown }>("desktop_settings", {}))
          .closeToTray === "boolean",
    ],
  ];

  const lines: string[] = [];
  let ok = true;
  for (const [name, run] of checks) {
    let passed = false;
    try {
      passed = await run();
    } catch (err) {
      lines.push(`  ${String(err)}`);
    }
    ok &&= passed;
    lines.push(`${passed ? "PASS" : "FAIL"} ${name}`);
  }
  lines.push(`webview: ${navigator.userAgent}`);
  await invoke("smoke_report", { ok, lines });
}
