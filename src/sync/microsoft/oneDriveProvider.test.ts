// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, test, vi } from "vitest";
import { openDb } from "../../data/db.ts";
import { INBOX_ID } from "../../data/model.ts";
import { createActions } from "../../state/actions.ts";
import { type App, createApp } from "../../state/store.ts";
import { createSyncEngine, type SyncEngine } from "../engine.ts";
import {
  AuthError,
  ConflictError,
  NoStorageError,
  ProviderError,
} from "../provider.ts";
import { createFakeGraph } from "./fakeGraph.ts";
import { createOneDriveProvider } from "./oneDriveProvider.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

function setup(options?: { pageSize?: number; autoParents?: boolean }) {
  const graph = createFakeGraph(options);
  const onUnauthorized = vi.fn();
  const provider = createOneDriveProvider({
    token: graph.token,
    fetch: graph.fetch,
    onUnauthorized,
  });
  return { graph, provider, onUnauthorized };
}

test("write, read, list and delete, with a new ETag per write", async () => {
  const { provider } = setup();
  expect(await provider.read("a.json")).toBeNull();

  const one = await provider.write("a.json", bytes("one"));
  const two = await provider.write("a.json", bytes("two"));
  expect(one.etag).not.toBe(two.etag);
  const read = await provider.read("a.json");
  expect(text(read?.data)).toBe("two");
  expect(read?.etag).toBe(two.etag);

  await provider.write("lists/x y%.json", bytes("x"));
  expect(await provider.list()).toEqual([
    { path: "a.json", etag: two.etag, size: 3 },
    { path: "lists/x y%.json", etag: expect.any(String), size: 1 },
  ]);
  expect(text((await provider.read("lists/x y%.json"))?.data)).toBe("x");
  await provider.delete("a.json");
  await provider.delete("a.json");
  expect(await provider.read("a.json")).toBeNull();
});

test("If-Match: only writes over the version we saw", async () => {
  const { provider, graph } = setup();
  const { etag } = await provider.write("a.json", bytes("mine"));
  graph.external.write("a.json", bytes("theirs"));

  await expect(provider.write("a.json", bytes("again"), etag)).rejects.toThrow(
    ConflictError,
  );
  const now = await provider.read("a.json");
  expect(text(now?.data)).toBe("theirs");
  await provider.write("a.json", bytes("merged"), now?.etag);
  expect(text((await provider.read("a.json"))?.data)).toBe("merged");

  // Gone since: Graph doesn't call that a conflict, it just makes the file again
  graph.external.delete("a.json");
  await provider.write("a.json", bytes("again"), now?.etag);
  expect(text((await provider.read("a.json"))?.data)).toBe("again");
});

test("null If-Match only creates, never overwrites", async () => {
  const { provider } = setup();
  await provider.write("new.json", bytes("first"), null);
  await expect(
    provider.write("new.json", bytes("second"), null),
  ).rejects.toThrow(ConflictError);
});

test("makes the lists folder itself when Graph won't", async () => {
  const { provider, graph } = setup({ autoParents: false });
  await provider.write("lists/a.json", bytes("a"), null);
  expect(graph.folders()).toEqual(["lists"]);
  expect(text((await provider.read("lists/a.json"))?.data)).toBe("a");
});

test("a file deleted between finding and downloading reads as gone", async () => {
  const { provider, graph } = setup();
  await provider.write("a.json", bytes("a"));
  // The first GET finds the file, the second downloads it
  graph.beforeNext("GET", () => undefined);
  graph.beforeNext("GET", () => graph.external.delete("a.json"));
  expect(await provider.read("a.json")).toBeNull();
});

test("changesSince lists everything first, then just what changed, deletes too", async () => {
  const { provider, graph } = setup({ pageSize: 2 });
  await provider.write("a.json", bytes("a"));
  await provider.write("b.json", bytes("b"));
  await provider.write("lists/c.json", bytes("c"));
  const first = await provider.changesSince();
  expect(first.changed).toEqual(["a.json", "b.json", "lists/c.json"]);

  const quiet = await provider.changesSince(first.token);
  expect(quiet.changed).toEqual([]);

  graph.external.write("b.json", bytes("b2"));
  graph.external.write("lists/d.json", bytes("d"));
  graph.external.delete("a.json");
  const next = await provider.changesSince(quiet.token);
  expect(next.changed).toEqual(["a.json", "b.json", "lists/d.json"]);
  // An older token still works, as long as nothing newer was used
  expect((await provider.changesSince(next.token)).changed).toEqual([]);

  await expect(provider.changesSince("999")).rejects.toMatchObject({
    name: "ProviderError",
    retryable: false,
  });
  const other = createOneDriveProvider({
    token: graph.token,
    fetch: graph.fetch,
  });
  await expect(other.changesSince(next.token)).rejects.toThrow(ProviderError);
});

test("Graph's errors turn into the provider's", async () => {
  const { provider, graph, onUnauthorized } = setup();

  graph.respondNext(503);
  await expect(provider.read("a.json")).rejects.toMatchObject({
    name: "ProviderError",
    retryable: true,
  });
  graph.respondNext(429, "activityLimitReached");
  await expect(provider.list()).rejects.toMatchObject({ retryable: true });
  graph.respondNext(403, "accessDenied");
  await expect(provider.list()).rejects.toThrow(AuthError);

  graph.revoke();
  await expect(provider.list()).rejects.toThrow(AuthError);
  expect(onUnauthorized).toHaveBeenCalledOnce();
});

test("an account without OneDrive says so instead of retrying forever", async () => {
  const { provider, graph } = setup();
  // What Graph really answers for a tenant without SharePoint
  graph.respondNext(400, "BadRequest", "Tenant does not have a SPO license.");
  const err = await provider.list().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(NoStorageError);
  expect(err).toMatchObject({ retryable: false });
  // The app folder itself missing isn't an empty folder
  graph.respondNext(404, "itemNotFound");
  await expect(provider.list()).rejects.toThrow(ProviderError);
});

test("a dropped connection is worth another go", async () => {
  const provider = createOneDriveProvider({
    token: async () => "t",
    fetch: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  await expect(provider.read("a.json")).rejects.toMatchObject({
    name: "ProviderError",
    retryable: true,
  });
});

const opened: { app: App; engine: SyncEngine; close(): void }[] = [];

afterEach(() => {
  for (const o of opened.splice(0)) {
    o.engine.stop();
    o.app.dispose();
    o.close();
  }
  globalThis.indexedDB = new IDBFactory();
});

test("two devices sync through OneDrive with the real engine", async () => {
  const graph = createFakeGraph({ autoParents: false });
  const device = async (name: string) => {
    const db = await openDb({ name });
    const app = createApp(db, { channel: name });
    await app.load();
    const engine = createSyncEngine({
      app,
      provider: createOneDriveProvider({
        token: graph.token,
        fetch: graph.fetch,
      }),
      debounceMs: 0,
    });
    opened.push({ app, engine, close: () => db.close() });
    const sync = async () => {
      await engine.syncNow();
      await engine.settled();
      await app.flush();
    };
    const titles = () =>
      Object.values(app.store.getState().tasks)
        .filter((t) => t.deletedAt === null)
        .map((t) => t.title)
        .sort();
    return { engine, actions: createActions(app), sync, titles };
  };

  const a = await device("a");
  const b = await device("b");
  a.actions.addTask(INBOX_ID, "Milk");
  b.actions.addTask(INBOX_ID, "Bread");
  await Promise.all([a.sync(), b.sync()]);
  await a.sync();
  await b.sync();
  await a.sync();

  expect(a.titles()).toEqual(["Bread", "Milk"]);
  expect(b.titles()).toEqual(["Bread", "Milk"]);
  expect(a.engine.status.getState().phase).toBe("idle");
  expect(graph.paths()).toContain("manifest.json");
});
