import {
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  openDB,
  type StoreNames,
} from "idb";
import {
  createInbox,
  type List,
  type ListGroup,
  type SettingRecord,
  type Step,
  type Task,
} from "./model.ts";

export interface DoozlySchema extends DBSchema {
  lists: { key: string; value: List };
  groups: { key: string; value: ListGroup };
  tasks: { key: string; value: Task; indexes: { byList: string } };
  steps: { key: string; value: Step; indexes: { byTask: string } };
  settings: { key: string; value: SettingRecord };
}

export type Db = IDBPDatabase<DoozlySchema>;
type StoreName = StoreNames<DoozlySchema>;
const storeNames: StoreName[] = [
  "lists",
  "groups",
  "tasks",
  "steps",
  "settings",
];

export type Migration = (
  db: Db,
  tx: IDBPTransaction<DoozlySchema, StoreName[], "versionchange">,
) => void;

// migrations[n] takes the database from version n to n+1. Only ever append, never edit an old one.
export const migrations: Migration[] = [
  (db, tx) => {
    db.createObjectStore("lists", { keyPath: "id" });
    db.createObjectStore("groups", { keyPath: "id" });
    db.createObjectStore("tasks", { keyPath: "id" }).createIndex(
      "byList",
      "listId",
    );
    db.createObjectStore("steps", { keyPath: "id" }).createIndex(
      "byTask",
      "taskId",
    );
    db.createObjectStore("settings", { keyPath: "key" });
    void tx.objectStore("lists").put(createInbox());
  },
];

interface OpenOptions {
  name?: string;
  migrations?: Migration[];
  /** Another tab wants to upgrade. We already closed, the app should reload. */
  onBlocking?: () => void;
}

export async function openDb({
  name = "doozly",
  migrations: steps = migrations,
  onBlocking,
}: OpenOptions = {}): Promise<Db> {
  const db = await openDB<DoozlySchema>(name, steps.length, {
    upgrade(db, oldVersion, _newVersion, tx) {
      for (let v = oldVersion; v < steps.length; v++) steps[v]?.(db, tx);
    },
    blocking() {
      db.close();
      onBlocking?.();
    },
  });
  return db;
}

export interface Snapshot {
  lists: List[];
  groups: ListGroup[];
  tasks: Task[];
  steps: Step[];
  settings: SettingRecord[];
}

/** Everything, tombstones included, to fill the in-memory store at start */
export async function loadAll(db: Db): Promise<Snapshot> {
  const tx = db.transaction(storeNames, "readonly");
  const [lists, groups, tasks, steps, settings] = await Promise.all([
    tx.objectStore("lists").getAll(),
    tx.objectStore("groups").getAll(),
    tx.objectStore("tasks").getAll(),
    tx.objectStore("steps").getAll(),
    tx.objectStore("settings").getAll(),
  ]);
  return { lists, groups, tasks, steps, settings };
}

export type Batch = Partial<Snapshot>;

/** Record keys per store, like what another tab tells us it just wrote */
export type Keys = Partial<Record<keyof Snapshot, string[]>>;

/** Reads the given records fresh. Ones that don't exist (any more) are left out. */
export async function loadRecords(db: Db, keys: Keys): Promise<Batch> {
  const names = storeNames.filter((n) => keys[n]?.length);
  if (names.length === 0) return {};
  const tx = db.transaction(names, "readonly");
  const read = <N extends StoreName>(n: N) =>
    Promise.all((keys[n] ?? []).map((k) => tx.objectStore(n).get(k))).then(
      (rows) => rows.filter((r) => r !== undefined),
    );
  const [lists, groups, tasks, steps, settings] = await Promise.all([
    read("lists"),
    read("groups"),
    read("tasks"),
    read("steps"),
    read("settings"),
  ]);
  return { lists, groups, tasks, steps, settings };
}

/** Writes all records in one transaction: either everything lands or nothing does */
export async function writeBatch(db: Db, batch: Batch): Promise<void> {
  const names = storeNames.filter((n) => batch[n]?.length);
  if (names.length === 0) return;

  const tx = db.transaction(names, "readwrite");
  const puts: Promise<unknown>[] = [];
  try {
    for (const r of batch.lists ?? [])
      puts.push(tx.objectStore("lists").put(r));
    for (const r of batch.groups ?? [])
      puts.push(tx.objectStore("groups").put(r));
    for (const r of batch.tasks ?? [])
      puts.push(tx.objectStore("tasks").put(r));
    for (const r of batch.steps ?? [])
      puts.push(tx.objectStore("steps").put(r));
    for (const r of batch.settings ?? [])
      puts.push(tx.objectStore("settings").put(r));
  } catch (err) {
    // A bad record throws right away, and without abort the earlier puts would still commit
    tx.abort();
    await Promise.allSettled([...puts, tx.done]);
    throw err;
  }
  await Promise.all([...puts, tx.done]);
}
