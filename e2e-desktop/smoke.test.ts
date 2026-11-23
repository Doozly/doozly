import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { KEYS, Session, startDriver } from "./webdriver.ts";

// The debug build, from `pnpm tauri build --debug --no-bundle`
const app =
  process.env.DOOZLY_APP ??
  resolve(
    import.meta.dirname,
    "../src-tauri/target/debug",
    process.platform === "win32" ? "doozly.exe" : "doozly",
  );

let driver: ChildProcess;
let s: Session;

before(async () => {
  driver = await startDriver();
  s = await Session.launch(app);
});

after(async () => {
  await s?.close().catch(() => {});
  driver?.kill();
});

const openTitles = () =>
  s.run<string[]>(
    `return [...document.querySelectorAll('ul[aria-label="Tasks"] [data-task-id] a')].map((a) => a.textContent.trim())`,
  );

const inboxStored = () =>
  s.run<string[]>(`return new Promise((resolve, reject) => {
    const open = indexedDB.open("doozly");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const read = open.result.transaction("tasks").objectStore("tasks").getAll();
      read.onsuccess = () => {
        resolve(read.result.sort((a, b) => (a.position < b.position ? -1 : 1)).map((t) => t.title));
        open.result.close();
      };
    };
  })`);

const sameOrder = async (want: string[]) =>
  (await openTitles()).join() === want.join();

test("opens on My Day, like To Do", async () => {
  await s.byText("h1", "My Day", 30_000);
  assert.equal(await s.title(), "My Day - Doozly");
});

test("the webview has the CSS the app relies on", async () => {
  const supported = await s.run<Record<string, boolean>>(`return {
    colorMix: CSS.supports("color", "color-mix(in oklab, red, transparent 50%)"),
    has: CSS.supports("selector(:has(*))"),
    nesting: CSS.supports("selector(&)"),
  }`);
  assert.deepEqual(supported, { colorMix: true, has: true, nesting: true });
  const font = await s.run<string>(
    "return getComputedStyle(document.body).fontFamily",
  );
  assert.match(font, /system-ui/);
});

test("no service worker inside the desktop app", async () => {
  const workers = await s.run<number>(
    "return navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : 0",
  );
  assert.equal(workers, 0);
});

test("tasks land in IndexedDB and are still there after a reload", async () => {
  await s.click(await s.find("css selector", 'a[href="/lists/inbox"]'));
  const add = await s.find("css selector", 'input[aria-label="Add a task"]');
  for (const title of ["One", "Two", "Three"]) {
    await s.type(add, title + KEYS.enter);
  }
  await s.until(() => sameOrder(["Three", "Two", "One"]), "three tasks");
  await s.until(
    async () => (await inboxStored()).length === 3,
    "the tasks in IndexedDB",
  );
  await s.refresh();
  await s.byText("h1", "Tasks", 30_000);
  await s.until(() => sameOrder(["Three", "Two", "One"]), "tasks after reload");
});

test("drag and drop reorders tasks in this webview", async () => {
  const one = await s.byText("a", "One");
  const three = await s.byText("a", "Three");
  await s.drag(one, three, -10);
  await s.until(() => sameOrder(["One", "Three", "Two"]), "the new order");
  await s.until(
    async () => (await inboxStored()).join() === "One,Three,Two",
    "the new order stored",
  );
});

test("Settings talks to the Rust side", async () => {
  await s.click(await s.find("css selector", 'button[aria-label="Settings"]'));
  await s.byText("h3", "Desktop");
  // The switches only show once desktop_settings has answered
  await s.byText("span", "Keep running in the tray when closed");
});

test("the window won't leave the app for a web page", async () => {
  const home = await s.run<string>("return location.origin");
  // The guard hands it to the browser instead, on CI there's none to open
  await s.run("location.href = 'https://example.invalid/'; return null");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await s.run<string>("return location.origin"), home);
  // Still the app, on whichever list the tests before left it
  await s.find("css selector", "main h1");
});
