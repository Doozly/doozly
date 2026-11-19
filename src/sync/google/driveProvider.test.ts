// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, test, vi } from "vitest";
import { openDb } from "../../data/db.ts";
import { INBOX_ID } from "../../data/model.ts";
import { createActions } from "../../state/actions.ts";
import { type App, createApp } from "../../state/store.ts";
import { createSyncEngine, type SyncEngine } from "../engine.ts";
import { AuthError, ConflictError, ProviderError } from "../provider.ts";
import { createDriveProvider } from "./driveProvider.ts";
import { createFakeDrive } from "./fakeDrive.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

function setup(options?: { pageSize?: number }) {
  const drive = createFakeDrive(options);
  const onUnauthorized = vi.fn();
  const provider = createDriveProvider({
    token: drive.token,
    fetch: drive.fetch,
    onUnauthorized,
  });
  return { drive, provider, onUnauthorized };
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

  await provider.write("lists/x'y.json", bytes("x"));
  expect((await provider.list()).map((f) => f.path)).toEqual([
    "a.json",
    "lists/x'y.json",
  ]);
  expect(text((await provider.read("lists/x'y.json"))?.data)).toBe("x");
  await provider.delete("a.json");
  await provider.delete("a.json");
  expect(await provider.read("a.json")).toBeNull();
});

test("If-Match: only writes over the version we saw", async () => {
  const { provider, drive } = setup();
  const { etag } = await provider.write("a.json", bytes("mine"));
  drive.external.write("a.json", bytes("theirs"));

  await expect(provider.write("a.json", bytes("again"), etag)).rejects.toThrow(
    ConflictError,
  );
  const now = await provider.read("a.json");
  expect(text(now?.data)).toBe("theirs");
  await provider.write("a.json", bytes("merged"), now?.etag);
  expect(text((await provider.read("a.json"))?.data)).toBe("merged");
});

test("an ETag for a file that's gone, or was made again, is a conflict", async () => {
  const { provider, drive } = setup();
  const { etag } = await provider.write("a.json", bytes("one"));
  const [file] = drive.named("a.json");
  drive.external.delete(file?.id ?? "");
  await expect(provider.write("a.json", bytes("x"), etag)).rejects.toThrow(
    ConflictError,
  );
  // Same version number, different file
  drive.external.write("a.json", bytes("new"));
  await expect(provider.write("a.json", bytes("x"), etag)).rejects.toThrow(
    ConflictError,
  );
});

test("a file deleted while we upload to it is a conflict", async () => {
  const { provider, drive } = setup();
  const { etag } = await provider.write("a.json", bytes("one"));
  drive.beforeNext("PATCH", () => {
    drive.external.delete(drive.named("a.json")[0]?.id ?? "");
  });
  await expect(provider.write("a.json", bytes("x"), etag)).rejects.toThrow(
    ConflictError,
  );
});

test("null If-Match only creates, never overwrites", async () => {
  const { provider } = setup();
  await provider.write("new.json", bytes("first"), null);
  await expect(
    provider.write("new.json", bytes("second"), null),
  ).rejects.toThrow(ConflictError);
});

test("two devices creating the same file: the older one wins, ours goes", async () => {
  const { provider, drive } = setup();
  // Another device creates it after we looked but before ours lands
  drive.beforeNext("POST", () =>
    drive.external.duplicate("m.json", bytes("theirs")),
  );
  await expect(provider.write("m.json", bytes("ours"), null)).rejects.toThrow(
    ConflictError,
  );
  expect(drive.named("m.json")).toHaveLength(1);
  expect(text((await provider.read("m.json"))?.data)).toBe("theirs");
});

test("a leftover duplicate is ignored, everyone uses the oldest", async () => {
  const { provider, drive } = setup();
  await provider.write("m.json", bytes("newer"));
  drive.external.duplicate("m.json", bytes("oldest"), true);

  expect(text((await provider.read("m.json"))?.data)).toBe("oldest");
  expect(await provider.list()).toHaveLength(1);
  const { etag } = await provider.write("m.json", bytes("merged"));
  expect((await provider.read("m.json"))?.etag).toBe(etag);
  await provider.delete("m.json");
  expect(drive.named("m.json")).toEqual([]);
});

test("changesSince lists everything first, then just what changed, deletes too", async () => {
  const { provider, drive } = setup({ pageSize: 2 });
  await provider.write("a.json", bytes("a"));
  await provider.write("b.json", bytes("b"));
  await provider.write("c.json", bytes("c"));
  const first = await provider.changesSince();
  expect(first.changed).toEqual(["a.json", "b.json", "c.json"]);

  const quiet = await provider.changesSince(first.token);
  expect(quiet.changed).toEqual([]);

  drive.external.write("b.json", bytes("b2"));
  drive.external.write("b.json", bytes("b3"));
  drive.external.write("d.json", bytes("d"));
  drive.external.delete(drive.named("a.json")[0]?.id ?? "");
  const next = await provider.changesSince(quiet.token);
  expect(next.changed).toEqual(["a.json", "b.json", "d.json"]);

  await expect(provider.changesSince("999")).rejects.toThrow(ProviderError);
  await expect(provider.changesSince("999")).rejects.toMatchObject({
    retryable: false,
  });
});

test("Drive's errors turn into the provider's", async () => {
  const { provider, drive, onUnauthorized } = setup();

  drive.respondNext(503);
  await expect(provider.read("a.json")).rejects.toMatchObject({
    name: "ProviderError",
    retryable: true,
  });
  drive.respondNext(403, "userRateLimitExceeded");
  await expect(provider.list()).rejects.toMatchObject({ retryable: true });
  drive.respondNext(403, "insufficientPermissions");
  await expect(provider.list()).rejects.toThrow(AuthError);

  drive.revoke();
  await expect(provider.list()).rejects.toThrow(AuthError);
  expect(onUnauthorized).toHaveBeenCalledOnce();
});

test("a dropped connection is worth another go", async () => {
  const provider = createDriveProvider({
    token: async () => "t",
    fetch: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  await expect(provider.read("a.json")).rejects.toMatchObject({
    name: "ProviderError",
    retryable: true,
  });
});

test("no token, no request", async () => {
  const fetch = vi.fn();
  const provider = createDriveProvider({
    token: () => Promise.reject(new AuthError()),
    fetch,
  });
  await expect(provider.list()).rejects.toThrow(AuthError);
  expect(fetch).not.toHaveBeenCalled();
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

test("two devices sync through Drive with the real engine", async () => {
  const drive = createFakeDrive();
  const device = async (name: string) => {
    const db = await openDb({ name });
    const app = createApp(db, { channel: name });
    await app.load();
    const engine = createSyncEngine({
      app,
      provider: createDriveProvider({ token: drive.token, fetch: drive.fetch }),
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
  // Both make manifest.json and the rest at about the same time
  await Promise.all([a.sync(), b.sync()]);
  await a.sync();
  await b.sync();
  await a.sync();

  expect(a.titles()).toEqual(["Bread", "Milk"]);
  expect(b.titles()).toEqual(["Bread", "Milk"]);
  expect(a.engine.status.getState().phase).toBe("idle");
  for (const f of ["manifest.json", "settings.json"]) {
    expect(drive.named(f)).toHaveLength(1);
  }
});
