// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, test } from "vitest";
import { openDb } from "../data/db.ts";
import { INBOX_ID } from "../data/model.ts";
import { createActions } from "../state/actions.ts";
import { type App, createApp } from "../state/store.ts";
import { createSyncEngine, type SyncEngine } from "./engine.ts";
import {
  decodeList,
  encode,
  listPath,
  MANIFEST_PATH,
  SCHEMA_VERSION,
  SETTINGS_PATH,
} from "./files.ts";
import { createMemoryProvider, type MemoryProvider } from "./memoryProvider.ts";
import { listFileFor } from "./merge.ts";
import { AuthError, NoStorageError } from "./provider.ts";

const opened: { app: App; engine: SyncEngine; close(): void }[] = [];

afterEach(() => {
  for (const o of opened.splice(0)) {
    o.engine.stop();
    o.app.dispose();
    o.close();
  }
  globalThis.indexedDB = new IDBFactory();
});

/** One device: its own database and engine, sharing the cloud folder with the others */
async function device(name: string, cloud: MemoryProvider) {
  const db = await openDb({ name });
  const app = createApp(db, { channel: name });
  await app.load();
  const engine = createSyncEngine({
    app,
    provider: cloud.provider,
    debounceMs: 0,
  });
  opened.push({ app, engine, close: () => db.close() });
  const actions = createActions(app);
  const titles = () =>
    Object.values(app.store.getState().tasks)
      .filter((t) => t.deletedAt === null)
      .map((t) => t.title)
      .sort();
  const sync = async () => {
    await engine.syncNow();
    await engine.settled();
    await app.flush();
  };
  return { app, engine, actions, titles, sync, state: app.store.getState };
}

const listFile = async (cloud: MemoryProvider, listId: string) => {
  const got = await cloud.provider.read(listPath(listId));
  if (!got) throw new Error("no file");
  return decodeList(listPath(listId), got.data);
};

test("first sync to an empty folder writes every file", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  a.actions.addTask(INBOX_ID, "Milk");
  const shop = a.actions.addList("Shopping");
  a.actions.addTask(shop.id, "Bread");

  await a.sync();
  expect(cloud.paths()).toEqual(
    [
      MANIFEST_PATH,
      SETTINGS_PATH,
      listPath(INBOX_ID),
      listPath(shop.id),
    ].sort(),
  );
  expect((await listFile(cloud, shop.id)).tasks.map((t) => t.title)).toEqual([
    "Bread",
  ]);
  expect(a.engine.status.getState()).toMatchObject({
    phase: "idle",
    pending: 0,
  });
});

test("a new, empty device gets everything", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  const shop = a.actions.addList("Shopping");
  a.actions.addTask(shop.id, "Bread");
  a.actions.addGroup("Home");
  a.actions.setSetting("confirmBeforeDelete", false);
  await a.sync();

  const b = await device("b", cloud);
  await b.sync();
  expect(b.titles()).toEqual(["Bread"]);
  expect(Object.values(b.state().groups).map((g) => g.title)).toEqual(["Home"]);
  expect(b.state().settings.confirmBeforeDelete?.value).toBe(false);
  // Same Tasks list on both, not two of them
  expect(Object.keys(b.state().lists).sort()).toEqual(
    [INBOX_ID, shop.id].sort(),
  );
});

test("two devices that both have data end up the same", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  const b = await device("b", cloud);
  a.actions.addTask(INBOX_ID, "From A");
  b.actions.addTask(INBOX_ID, "From B");
  b.actions.addList("B's list");

  await a.sync();
  await b.sync();
  await a.sync();
  expect(a.titles()).toEqual(["From A", "From B"]);
  expect(b.titles()).toEqual(["From A", "From B"]);
  expect(Object.keys(a.state().lists).sort()).toEqual(
    Object.keys(b.state().lists).sort(),
  );
});

test("local changes push by themselves, and what came from remote isn't pushed back", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  const b = await device("b", cloud);
  await a.engine.start();
  await b.engine.start();

  a.actions.addTask(INBOX_ID, "Typed on A");
  await a.app.flush();
  await a.engine.settled();
  expect((await listFile(cloud, INBOX_ID)).tasks.map((t) => t.title)).toEqual([
    "Typed on A",
  ]);

  const writes = cloud.calls.write;
  await b.sync();
  expect(b.titles()).toEqual(["Typed on A"]);
  await b.engine.settled();
  expect(cloud.calls.write).toBe(writes);
});

test("a conflict on push pulls, merges and tries again", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  const b = await device("b", cloud);
  await a.sync();
  await b.sync();

  // Both edit the same file without hearing of each other
  b.actions.addTask(INBOX_ID, "From B");
  await b.sync();
  a.actions.addTask(INBOX_ID, "From A");
  await a.engine.start();
  await a.engine.settled();

  const inbox = await listFile(cloud, INBOX_ID);
  expect(inbox.tasks.map((t) => t.title).sort()).toEqual(["From A", "From B"]);
  expect(a.titles()).toEqual(["From A", "From B"]);
});

test("a push that hits a write conflict mid-flight still lands both changes", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  const b = await device("b", cloud);
  await a.sync();
  await b.sync();
  // B's version of the file, written between A's pull and A's push
  b.actions.addTask(INBOX_ID, "Theirs");
  const inbox = b.state().lists[INBOX_ID];
  if (!inbox) throw new Error("no inbox");
  const theirs = encode(
    listFileFor(inbox, {
      tasks: Object.values(b.state().tasks),
      steps: [],
    }),
  );

  a.actions.addTask(INBOX_ID, "Mine");
  cloud.conflictNext(listPath(INBOX_ID), theirs);
  await a.sync();
  expect(
    (await listFile(cloud, INBOX_ID)).tasks.map((t) => t.title).sort(),
  ).toEqual(["Mine", "Theirs"]);
  expect(a.titles()).toEqual(["Mine", "Theirs"]);
  expect(a.engine.status.getState().phase).toBe("idle");
});

test("network trouble keeps the queue, the next try sends it", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  await a.sync();
  a.actions.addTask(INBOX_ID, "Offline edit");
  cloud.failNext("write");
  await a.sync();
  expect(a.engine.status.getState()).toMatchObject({
    phase: "offline",
    pending: 1,
  });

  await a.sync();
  expect(a.engine.status.getState()).toMatchObject({
    phase: "idle",
    pending: 0,
  });
  expect((await listFile(cloud, INBOX_ID)).tasks.map((t) => t.title)).toEqual([
    "Offline edit",
  ]);
});

test("signed out pauses sync without blocking edits, resume drains the queue", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  await a.sync();
  cloud.failNext("changesSince", new AuthError());
  await a.sync();
  expect(a.engine.status.getState().phase).toBe("signedOut");

  a.actions.addTask(INBOX_ID, "Still works");
  expect(a.titles()).toEqual(["Still works"]);
  await a.sync();
  expect(cloud.calls.changesSince).toBe(2);

  await a.engine.resume();
  await a.engine.settled();
  expect((await listFile(cloud, INBOX_ID)).tasks.map((t) => t.title)).toEqual([
    "Still works",
  ]);
});

test("a file from a newer app stops sync, and is never written over", async () => {
  const cloud = createMemoryProvider();
  cloud.external.write(
    MANIFEST_PATH,
    encode({ schema: SCHEMA_VERSION + 1, groups: [], listIds: [] } as never),
  );
  const a = await device("a", cloud);
  a.actions.addTask(INBOX_ID, "Local only");
  await a.sync();
  expect(a.engine.status.getState().phase).toBe("newerApp");
  expect(cloud.calls.write).toBe(0);
});

test("a task moved to another list leaves its old file", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  const shop = a.actions.addList("Shopping");
  const milk = a.actions.addTask(INBOX_ID, "Milk");
  await a.sync();
  if (!milk) throw new Error("no task");

  a.actions.moveTaskToList(milk.id, shop.id);
  await a.sync();
  expect((await listFile(cloud, INBOX_ID)).tasks).toEqual([]);
  expect((await listFile(cloud, shop.id)).tasks.map((t) => t.title)).toEqual([
    "Milk",
  ]);

  const b = await device("b", cloud);
  await b.sync();
  expect(b.state().tasks[milk.id]?.listId).toBe(shop.id);
});

test("after the first sync, a pull only reads files that changed", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  const b = await device("b", cloud);
  for (let i = 0; i < 5; i++) a.actions.addList(`List ${i}`);
  await a.sync();
  await b.sync();
  await b.sync();

  const shop = Object.values(a.state().lists).find((l) => l.title === "List 3");
  if (!shop) throw new Error("no list");
  a.actions.addTask(shop.id, "Only here");
  await a.sync();

  const reads = cloud.calls.read;
  await b.sync();
  expect(cloud.calls.read - reads).toBe(1);
  expect(b.titles()).toEqual(["Only here"]);
});

test("an account without storage stops sync with its own phase", async () => {
  const cloud = createMemoryProvider();
  const a = await device("a", cloud);
  cloud.failNext("changesSince", new NoStorageError("no OneDrive"));
  await a.sync();
  expect(a.engine.status.getState()).toMatchObject({
    phase: "noStorage",
    error: "no OneDrive",
  });
  // Blocked: no retry loop, nothing written
  await a.sync();
  expect(cloud.calls.changesSince).toBe(1);
});
