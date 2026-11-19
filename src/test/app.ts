import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach } from "vitest";
import { openDb } from "../data/db.ts";
import { createActions } from "../state/actions.ts";
import { type App, createApp } from "../state/store.ts";

const opened: { app: App; close(): void }[] = [];

afterEach(() => {
  for (const o of opened.splice(0)) {
    o.app.dispose();
    o.close();
  }
  globalThis.indexedDB = new IDBFactory();
});

/** A loaded app on a fresh fake IndexedDB. Pass the same channel to get a "second tab". */
export async function testApp(channel: string = crypto.randomUUID()) {
  const db = await openDb();
  const app = createApp(db, { channel });
  await app.load();
  opened.push({ app, close: () => db.close() });
  return { db, app, actions: createActions(app), state: app.store.getState };
}
