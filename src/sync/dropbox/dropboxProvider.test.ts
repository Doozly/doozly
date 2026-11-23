// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, test, vi } from "vitest";
import { openDb } from "../../data/db.ts";
import { INBOX_ID } from "../../data/model.ts";
import { createActions } from "../../state/actions.ts";
import { type App, createApp } from "../../state/store.ts";
import { createSyncEngine, type SyncEngine } from "../engine.ts";
import { AuthError, ConflictError } from "../provider.ts";
import { createDropboxProvider, headerArg } from "./dropboxProvider.ts";
import { createFakeDropbox } from "./fakeDropbox.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

function setup(options?: { pageSize?: number }) {
  const dropbox = createFakeDropbox(options);
  const onUnauthorized = vi.fn();
  const provider = createDropboxProvider({
    token: dropbox.token,
    fetch: dropbox.fetch,
    onUnauthorized,
  });
  return { dropbox, provider, onUnauthorized };
}

test("write, read, list and delete, with a new rev per write", async () => {
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

test("a name keeps its case, though Dropbox compares without", async () => {
  const { provider } = setup();
  await provider.write("lists/AbC.json", bytes("x"));
  expect((await provider.list()).map((f) => f.path)).toEqual([
    "lists/AbC.json",
  ]);
});

test("update mode: only writes over the rev we saw", async () => {
  const { provider, dropbox } = setup();
  const { etag } = await provider.write("a.json", bytes("mine"));
  dropbox.external.write("a.json", bytes("theirs"));

  await expect(provider.write("a.json", bytes("again"), etag)).rejects.toThrow(
    ConflictError,
  );
  const now = await provider.read("a.json");
  expect(text(now?.data)).toBe("theirs");
  await provider.write("a.json", bytes("merged"), now?.etag);
  expect(text((await provider.read("a.json"))?.data)).toBe("merged");

  // Gone since: a conflict, so the engine reads it again and makes it new
  dropbox.external.delete("a.json");
  await expect(
    provider.write("a.json", bytes("again"), now?.etag),
  ).rejects.toThrow(ConflictError);
});

test("null rev only creates, never overwrites", async () => {
  const { provider } = setup();
  await provider.write("lists/new.json", bytes("first"), null);
  await expect(
    provider.write("lists/new.json", bytes("second"), null),
  ).rejects.toThrow(ConflictError);
});

test("changesSince lists everything first, then just what changed, deletes too", async () => {
  const { provider, dropbox } = setup({ pageSize: 2 });
  await provider.write("a.json", bytes("a"));
  await provider.write("b.json", bytes("b"));
  await provider.write("lists/c.json", bytes("c"));
  const first = await provider.changesSince();
  expect(first.changed).toEqual(["a.json", "b.json", "lists/c.json"]);

  const quiet = await provider.changesSince(first.token);
  expect(quiet.changed).toEqual([]);

  dropbox.external.write("b.json", bytes("b2"));
  dropbox.external.write("lists/d.json", bytes("d"));
  dropbox.external.delete("a.json");
  const next = await provider.changesSince(quiet.token);
  expect(next.changed).toEqual(["a.json", "b.json", "lists/d.json"]);
  expect((await provider.changesSince(next.token)).changed).toEqual([]);

  // Dropbox keeps cursors, another instance can pick one up
  const other = createDropboxProvider({
    token: dropbox.token,
    fetch: dropbox.fetch,
  });
  expect((await other.changesSince(next.token)).changed).toEqual([]);

  await expect(provider.changesSince("999:0")).rejects.toMatchObject({
    name: "ProviderError",
    retryable: false,
  });
});

test("Dropbox's errors turn into the provider's", async () => {
  const { provider, dropbox, onUnauthorized } = setup();

  dropbox.respondNext(503);
  await expect(provider.read("a.json")).rejects.toMatchObject({
    name: "ProviderError",
    retryable: true,
  });
  dropbox.respondNext(429, { error_summary: "too_many_requests/" });
  await expect(provider.list()).rejects.toMatchObject({ retryable: true });
  dropbox.respondNext(400, "Error in call to API function");
  await expect(provider.list()).rejects.toMatchObject({ retryable: false });
  dropbox.respondNext(403);
  await expect(provider.list()).rejects.toThrow(AuthError);
  // A full Dropbox clears up once the user makes room
  dropbox.respondNext(409, { error_summary: "path/insufficient_space/.." });
  await expect(provider.write("a.json", bytes("a"))).rejects.toMatchObject({
    name: "ProviderError",
    retryable: true,
  });

  dropbox.revoke();
  await expect(provider.list()).rejects.toThrow(AuthError);
  expect(onUnauthorized).toHaveBeenCalledOnce();
});

test("a dropped connection is worth another go", async () => {
  const provider = createDropboxProvider({
    token: async () => "t",
    fetch: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  await expect(provider.read("a.json")).rejects.toMatchObject({
    name: "ProviderError",
    retryable: true,
  });
});

test("the header argument is plain ASCII", () => {
  expect(headerArg({ path: "/lists/ä😀.json" })).toBe(
    '{"path":"/lists/\\u00e4\\ud83d\\ude00.json"}',
  );
  expect(() => new Headers({ a: headerArg({ p: "€" }) })).not.toThrow();
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

test("two devices sync through Dropbox with the real engine", async () => {
  const dropbox = createFakeDropbox();
  const device = async (name: string) => {
    const db = await openDb({ name });
    const app = createApp(db, { channel: name });
    await app.load();
    const engine = createSyncEngine({
      app,
      provider: createDropboxProvider({
        token: dropbox.token,
        fetch: dropbox.fetch,
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
  expect(dropbox.paths()).toContain("manifest.json");
});
