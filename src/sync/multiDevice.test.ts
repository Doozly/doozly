// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, test } from "vitest";
import { openDb } from "../data/db.ts";
import { INBOX_ID } from "../data/model.ts";
import { createActions } from "../state/actions.ts";
import { type App, createApp } from "../state/store.ts";
import { createSyncEngine, type SyncEngine } from "./engine.ts";
import { createDriveProvider } from "./google/driveProvider.ts";
import { createFakeDrive } from "./google/fakeDrive.ts";
import { createFakeGraph } from "./microsoft/fakeGraph.ts";
import { createOneDriveProvider } from "./microsoft/oneDriveProvider.ts";
import { AuthError, type StorageProvider } from "./provider.ts";

// The #276 scenarios, each run against both providers' fakes with the real engine

interface Cloud {
  fetch: typeof globalThis.fetch;
  provider(options: {
    token: () => Promise<string>;
    fetch: typeof globalThis.fetch;
  }): StorageProvider;
}

const clouds: [string, () => Cloud][] = [
  [
    "Google Drive",
    () => {
      const drive = createFakeDrive();
      return { fetch: drive.fetch, provider: createDriveProvider };
    },
  ],
  [
    "OneDrive",
    () => {
      const graph = createFakeGraph({ autoParents: false });
      return { fetch: graph.fetch, provider: createOneDriveProvider };
    },
  ],
];

const opened: { app: App; engine: SyncEngine; close(): void }[] = [];

afterEach(() => {
  for (const o of opened.splice(0)) {
    o.engine.stop();
    o.app.dispose();
    o.close();
  }
  globalThis.indexedDB = new IDBFactory();
});

// Stamps from two devices in the same millisecond have no real order, so "later" needs a tick
const later = () => new Promise((resolve) => setTimeout(resolve, 3));

async function device(name: string, cloud: Cloud, { signedIn = true } = {}) {
  const db = await openDb({ name });
  const app = createApp(db, { channel: name });
  await app.load();
  const net = {
    offline: false,
    /** From this many requests on, the provider answers 401 like for a run-out token */
    expireAfter: Number.POSITIVE_INFINITY,
    requests: 0,
    tokenGone: false,
  };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (net.offline) throw new TypeError("Failed to fetch");
    if (++net.requests > net.expireAfter) {
      return new Response(
        JSON.stringify({ error: { code: "unauthenticated", message: "" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    return cloud.fetch(input, init);
  }) as typeof globalThis.fetch;
  const token = async () => {
    if (net.tokenGone) throw new AuthError("signed out");
    return "token";
  };
  const engine = createSyncEngine({
    app,
    provider: cloud.provider({ token, fetch }),
    debounceMs: 0,
  });
  opened.push({ app, engine, close: () => db.close() });
  const settled = async () => {
    await engine.settled();
    await app.flush();
  };
  // Like the session does once someone is signed in: watch the store and sync
  const signIn = async () => {
    await engine.start();
    await settled();
  };
  if (signedIn) await signIn();
  const state = app.store.getState;
  const live = <T extends { deletedAt: number | null }>(
    records: Record<string, T>,
  ) => Object.values(records).filter((r) => r.deletedAt === null);
  const actions = createActions(app);
  return {
    app,
    engine,
    net,
    actions,
    state,
    phase: () => engine.status.getState().phase,
    signIn,
    /** A task in Tasks, for the ones a test edits later */
    add(title: string) {
      const task = actions.addTask(INBOX_ID, title);
      if (!task) throw new Error(`couldn't add ${title}`);
      return task;
    },
    async sync() {
      await engine.syncNow();
      await settled();
    },
    /** Signing in again, as the account popover's "Sign in again" does */
    async signInAgain() {
      net.expireAfter = Number.POSITIVE_INFINITY;
      net.tokenGone = false;
      await engine.resume();
      await settled();
    },
    /** What the user sees: live tasks in live lists, by title */
    titles() {
      const lists = new Set(live(state().lists).map((l) => l.id));
      return live(state().tasks)
        .filter((t) => lists.has(t.listId))
        .map((t) => t.title)
        .sort();
    },
    task: (title: string) => live(state().tasks).find((t) => t.title === title),
    listTitles: () =>
      live(state().lists)
        .map((l) => l.title)
        .sort(),
  };
}

type Device = Awaited<ReturnType<typeof device>>;

/** Syncs every device in turn until they agree, as polling would */
async function settle(...devices: Device[]) {
  for (let round = 0; round < 2; round++) {
    for (const d of devices) await d.sync();
  }
}

const snapshot = (d: Device) => ({
  titles: d.titles(),
  lists: d.listTitles(),
  tasks: Object.values(d.state().tasks)
    .map((t) => `${t.id}:${t.updatedAt}:${t.deletedAt}`)
    .sort(),
});

describe.each(clouds)("%s", (_, makeCloud) => {
  test("a second device signing in with data of its own merges, nothing doubles", async () => {
    const cloud = makeCloud();
    const a = await device("a", cloud);
    a.actions.addTask(INBOX_ID, "Milk");
    const work = a.actions.addList("Work");
    a.actions.addTask(work.id, "Report");
    a.actions.addGroup("Home");
    await a.sync();

    // B was used without an account before its first sign-in
    const b = await device("b", cloud, { signedIn: false });
    b.actions.addTask(INBOX_ID, "Bread");
    const trips = b.actions.addList("Trips");
    b.actions.addTask(trips.id, "Passport");
    b.actions.setSetting("confirmBeforeDelete", false);
    await b.app.flush();
    await b.signIn();
    await settle(b, a);

    expect(a.titles()).toEqual(["Bread", "Milk", "Passport", "Report"]);
    expect(snapshot(b)).toEqual(snapshot(a));
    // One Tasks list, not one per device
    expect(a.listTitles()).toEqual(["Tasks", "Trips", "Work"]);
    expect(a.state().settings.confirmBeforeDelete?.value).toBe(false);
    expect(Object.values(b.state().groups).map((g) => g.title)).toEqual([
      "Home",
    ]);
    expect([a.phase(), b.phase()]).toEqual(["idle", "idle"]);
  });

  test("concurrent edits: different tasks both land, the same task goes to the later edit", async () => {
    const cloud = makeCloud();
    const a = await device("a", cloud);
    const b = await device("b", cloud);
    const shared = a.add("Call the bank");
    await settle(a, b);

    // Both edit the same list file without seeing each other, then push at once
    a.net.offline = b.net.offline = true;
    a.actions.addTask(INBOX_ID, "From A");
    b.actions.addTask(INBOX_ID, "From B");
    a.actions.updateTask(shared.id, { title: "Call the bank today" });
    await later();
    b.actions.updateTask(shared.id, { title: "Call the bank at 10" });
    a.net.offline = b.net.offline = false;
    await Promise.all([a.sync(), b.sync()]);
    await settle(a, b);

    expect(a.titles()).toEqual(["Call the bank at 10", "From A", "From B"]);
    expect(snapshot(b)).toEqual(snapshot(a));
  });

  test("delete against edit: a later edit brings the task back, a later delete wins", async () => {
    const cloud = makeCloud();
    const a = await device("a", cloud);
    const b = await device("b", cloud);
    const revived = a.add("Revived");
    const gone = a.add("Gone");
    await settle(a, b);

    // B mustn't hear of A's delete before its own edit, or there'd be nothing to edit
    b.net.offline = true;
    a.actions.deleteTask(revived.id);
    b.actions.updateTask(gone.id, { note: "edited first" });
    await later();
    b.actions.updateTask(revived.id, { note: "edited after the delete" });
    a.actions.deleteTask(gone.id);
    await a.sync();
    b.net.offline = false;
    await settle(b, a);

    expect(a.titles()).toEqual(["Revived"]);
    expect(a.task("Revived")?.note).toBe("edited after the delete");
    expect(snapshot(b)).toEqual(snapshot(a));
  });

  test("a list deleted on one device while the other adds to it stays deleted on both", async () => {
    const cloud = makeCloud();
    const a = await device("a", cloud);
    const b = await device("b", cloud);
    const errands = a.actions.addList("Errands");
    a.actions.addTask(errands.id, "Post office");
    await settle(a, b);

    b.actions.addTask(errands.id, "Pharmacy");
    await later();
    a.actions.deleteList(errands.id);
    await settle(a, b);

    expect(a.listTitles()).toEqual(["Tasks"]);
    expect(a.titles()).toEqual([]);
    expect(snapshot(b)).toEqual(snapshot(a));
  });

  test("edits made offline go up when the device is back, alongside the other device's", async () => {
    const cloud = makeCloud();
    const a = await device("a", cloud);
    const b = await device("b", cloud);
    const eggs = a.add("Eggs");
    const flour = a.add("Flour");
    await settle(a, b);

    b.net.offline = true;
    b.actions.addTask(INBOX_ID, "Butter");
    b.actions.toggleCompleted(eggs.id);
    b.actions.addList("Offline list");
    await b.sync();
    expect(b.phase()).toBe("offline");
    expect(b.engine.status.getState().pending).toBeGreaterThan(0);
    // The app still works meanwhile
    expect(b.titles()).toEqual(["Butter", "Eggs", "Flour"]);

    a.actions.deleteTask(flour.id);
    a.actions.addTask(INBOX_ID, "Sugar");
    await a.sync();

    b.net.offline = false;
    await settle(b, a);
    expect(a.titles()).toEqual(["Butter", "Eggs", "Sugar"]);
    expect(a.task("Eggs")?.completedAt).not.toBeNull();
    expect(a.listTitles()).toEqual(["Offline list", "Tasks"]);
    expect(snapshot(b)).toEqual(snapshot(a));
    expect(b.engine.status.getState()).toMatchObject({
      phase: "idle",
      pending: 0,
    });
  });

  test("a token that runs out in the middle of a sync loses nothing", async () => {
    const cloud = makeCloud();
    const a = await device("a", cloud);
    for (const title of ["One", "Two", "Three"]) {
      a.actions.addList(title);
    }
    a.actions.addTask(INBOX_ID, "From A");
    await a.sync();

    const b = await device("b", cloud, { signedIn: false });
    b.actions.addTask(INBOX_ID, "From B");
    await b.app.flush();
    // Its first full sync gets a few requests in, then the provider says 401
    b.net.expireAfter = 3;
    await b.signIn();
    expect(b.phase()).toBe("signedOut");

    // Editing goes on while signed out
    b.actions.addTask(INBOX_ID, "While signed out");
    await b.sync();
    expect(b.phase()).toBe("signedOut");

    await b.signInAgain();
    await settle(a, b);
    expect(a.titles()).toEqual(["From A", "From B", "While signed out"]);
    expect(snapshot(b)).toEqual(snapshot(a));
    expect(b.phase()).toBe("idle");
  });

  test("a token the auth library already knows is gone pauses sync the same way", async () => {
    const cloud = makeCloud();
    const a = await device("a", cloud);
    const b = await device("b", cloud);
    a.actions.addTask(INBOX_ID, "Before");
    await settle(a, b);

    b.net.tokenGone = true;
    b.actions.addTask(INBOX_ID, "Queued");
    await b.sync();
    expect(b.phase()).toBe("signedOut");

    a.actions.addTask(INBOX_ID, "Meanwhile");
    await a.sync();
    await b.signInAgain();
    await settle(a, b);
    expect(b.titles()).toEqual(["Before", "Meanwhile", "Queued"]);
    expect(snapshot(b)).toEqual(snapshot(a));
  });
});
