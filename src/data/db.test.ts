// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, test } from "vitest";
import { stamp } from "./clock.ts";
import {
  loadAll,
  loadRecords,
  type Migration,
  migrations,
  openDb,
  writeBatch,
} from "./db.ts";
import {
  createGroup,
  createList,
  createStep,
  createTask,
  INBOX_ID,
  type Task,
} from "./model.ts";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

test("a new database starts with only the inbox", async () => {
  const db = await openDb();
  const all = await loadAll(db);
  expect(all.lists.map((l) => l.id)).toEqual([INBOX_ID]);
  expect(all.tasks).toEqual([]);
  db.close();
});

test("a batch across stores comes back after reopening", async () => {
  const db = await openDb();
  const list = createList({ title: "Shopping", position: "a1" });
  const group = createGroup({ title: "Home", position: "a0" });
  const task = createTask({ listId: list.id, title: "Milk", position: "a0" });
  const step = createStep({ taskId: task.id, title: "Oat", position: "a0" });
  await writeBatch(db, {
    lists: [list],
    groups: [group],
    tasks: [task],
    steps: [step],
    settings: [{ key: "theme", value: "dark", updatedAt: stamp() }],
  });
  db.close();

  const again = await openDb();
  const all = await loadAll(again);
  expect(all.lists).toContainEqual(list);
  expect(all.groups).toEqual([group]);
  expect(all.tasks).toEqual([task]);
  expect(all.steps).toEqual([step]);
  expect(all.settings).toEqual([expect.objectContaining({ value: "dark" })]);
  again.close();
});

test("tombstones are kept, not dropped", async () => {
  const db = await openDb();
  const task = createTask({ listId: INBOX_ID, title: "Gone", position: "a0" });
  await writeBatch(db, { tasks: [{ ...task, deletedAt: Date.now() }] });
  const { tasks } = await loadAll(db);
  expect(tasks[0]?.deletedAt).not.toBeNull();
  db.close();
});

test("a batch with one bad record writes nothing at all", async () => {
  const db = await openDb();
  const good = createTask({ listId: INBOX_ID, title: "Fine", position: "a0" });
  const bad = { ...good, id: undefined } as unknown as Task;
  await expect(writeBatch(db, { tasks: [good, bad] })).rejects.toThrow();
  expect((await loadAll(db)).tasks).toEqual([]);
  db.close();
});

test("an empty batch is a no-op", async () => {
  const db = await openDb();
  await expect(writeBatch(db, { tasks: [] })).resolves.toBeUndefined();
  db.close();
});

test("upgrading runs only the new migrations and keeps the data", async () => {
  const runs: number[] = [];
  const v1: Migration = (db, tx) => {
    runs.push(1);
    migrations[0]?.(db, tx);
  };
  const v2: Migration = (_db, tx) => {
    runs.push(2);
    tx.objectStore("lists")
      .openCursor()
      .then(async function rename(cursor) {
        if (!cursor) return;
        await cursor.update({
          ...cursor.value,
          title: `${cursor.value.title}!`,
        });
        rename(await cursor.continue());
      });
  };

  const db1 = await openDb({ migrations: [v1] });
  db1.close();
  const db2 = await openDb({ migrations: [v1, v2] });
  expect(db2.version).toBe(2);
  expect(runs).toEqual([1, 2]);
  expect((await loadAll(db2)).lists.map((l) => l.title)).toEqual(["Tasks!"]);
  db2.close();
});

test("an older tab gets told when a newer one wants to upgrade", async () => {
  let blocked = false;
  const old = await openDb({ onBlocking: () => (blocked = true) });
  const newer = await openDb({ migrations: [...migrations, () => {}] });
  expect(blocked).toBe(true);
  expect(newer.version).toBe(migrations.length + 1);
  newer.close();
  old.close();
});

test("loadRecords reads just the asked ones and skips missing", async () => {
  const db = await openDb();
  const a = createTask({ listId: INBOX_ID, title: "A", position: "a0" });
  const b = createTask({ listId: INBOX_ID, title: "B", position: "a1" });
  await writeBatch(db, { tasks: [a, b] });
  const got = await loadRecords(db, {
    tasks: [b.id, "nope"],
    lists: [INBOX_ID],
  });
  expect(got.tasks).toEqual([b]);
  expect(got.lists?.map((l) => l.id)).toEqual([INBOX_ID]);
  expect(got.steps).toEqual([]);
  expect(await loadRecords(db, {})).toEqual({});
  db.close();
});
