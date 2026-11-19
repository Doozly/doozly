import { createStore, type StoreApi } from "zustand/vanilla";
import { stamp } from "../data/clock.ts";
import {
  type Batch,
  type Db,
  type Keys,
  loadAll,
  loadRecords,
  writeBatch,
} from "../data/db.ts";
import type {
  List,
  ListGroup,
  SettingRecord,
  Step,
  Task,
} from "../data/model.ts";

export interface Tables {
  lists: Record<string, List>;
  groups: Record<string, ListGroup>;
  tasks: Record<string, Task>;
  steps: Record<string, Step>;
  settings: Record<string, SettingRecord>;
}

type Table = keyof Tables;
const tableNames: Table[] = ["lists", "groups", "tasks", "steps", "settings"];

export interface AppState extends Tables {
  status: "loading" | "ready" | "failed";
  /** Set when a change couldn't be saved and got rolled back */
  saveError: string | null;
}

export type Undo = () => void;

export interface App {
  store: StoreApi<AppState>;
  load(): Promise<void>;
  /** The one way to change data: memory now, disk right after, other tabs once saved */
  commit(batch: Batch): Undo;
  /** Resolves when every write so far is on disk (or rolled back) */
  flush(): Promise<void>;
  dispose(): void;
}

type AnyRecord = Tables[Table][string];
type Rows = Record<string, AnyRecord>;

const keyOf = (r: AnyRecord) => ("id" in r ? r.id : r.key);

function withRecords(state: Tables, batch: Batch): Partial<Tables> {
  const next: Partial<Record<Table, Rows>> = {};
  for (const t of tableNames) {
    const rows = batch[t];
    if (!rows?.length) continue;
    const map: Rows = { ...state[t] };
    for (const r of rows) map[keyOf(r)] = r;
    next[t] = map;
  }
  return next as Partial<Tables>;
}

function keysOf(batch: Batch): Keys {
  const keys: Keys = {};
  for (const t of tableNames) {
    const rows = batch[t];
    if (rows?.length) keys[t] = rows.map(keyOf);
  }
  return keys;
}

const empty: Tables = {
  lists: {},
  groups: {},
  tasks: {},
  steps: {},
  settings: {},
};

export function createApp(
  db: Db,
  { channel: channelName = "doozly" } = {},
): App {
  const store = createStore<AppState>()(() => ({
    ...empty,
    status: "loading",
    saveError: null,
  }));
  const pending = new Set<Promise<void>>();
  let channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(channelName);

  channel?.addEventListener("message", (e: MessageEvent<Keys>) => {
    track(refresh(e.data));
  });

  // A failed refresh from another tab is no drama, the next load picks it up
  function track(p: Promise<void>) {
    const done: Promise<void> = p
      .catch(() => {})
      .finally(() => pending.delete(done));
    pending.add(done);
  }

  async function refresh(keys: Keys) {
    const fresh = await loadRecords(db, keys);
    // Keep ours if it's newer, it may still be on the way to disk
    const state = store.getState();
    const newer: Batch = {};
    for (const t of tableNames) {
      const current = state[t] as Rows;
      const rows = (fresh[t] ?? []).filter((r: AnyRecord) => {
        const mine = current[keyOf(r)];
        return !mine || r.updatedAt > mine.updatedAt;
      });
      if (rows.length) (newer as Record<Table, AnyRecord[]>)[t] = rows;
    }
    store.setState(withRecords(state, newer));
  }

  async function load() {
    try {
      const all = await loadAll(db);
      store.setState({ ...empty, ...withRecords(empty, all), status: "ready" });
    } catch (err) {
      store.setState({ status: "failed", saveError: String(err) });
    }
  }

  type Before = { table: Table; record: AnyRecord; previous?: AnyRecord };

  function commit(batch: Batch): Undo {
    const state = store.getState();
    const before: Before[] = [];
    for (const t of tableNames) {
      for (const record of batch[t] ?? []) {
        before.push({
          table: t,
          record,
          previous: (state[t] as Rows)[keyOf(record)],
        });
      }
    }

    store.setState(withRecords(state, batch));

    // Readwrite transactions on the same stores run in the order they're made,
    // also the writes land in commit order even without awaiting here.
    // Later the sync queue gets fed from this same spot.
    track(
      writeBatch(db, batch).then(
        () => channel?.postMessage(keysOf(batch)),
        (err) => {
          rollback(before);
          store.setState({ saveError: String(err) });
        },
      ),
    );

    return () => undo(before);
  }

  function rollback(before: Before[]) {
    const state = store.getState();
    const next: Partial<Record<Table, Rows>> = {};
    for (const { table, record, previous } of before) {
      const key = keyOf(record);
      // Only if nothing newer replaced it meanwhile
      if ((state[table] as Rows)[key] !== record) continue;
      next[table] ??= { ...(state[table] as Rows) };
      const map = next[table];
      if (previous) map[key] = previous;
      else delete map[key];
    }
    store.setState(next as Partial<Tables>);
  }

  function undo(before: Before[]) {
    const now = Date.now();
    const batch: Record<string, AnyRecord[]> = {};
    for (const { table, record, previous } of before) {
      let restored: AnyRecord | undefined;
      if (previous) restored = { ...previous, updatedAt: stamp() };
      // Something new gets a tombstone. Settings have none, they just stay.
      else if ("deletedAt" in record)
        restored = { ...record, deletedAt: now, updatedAt: stamp() };
      if (!restored) continue;
      batch[table] ??= [];
      batch[table].push(restored);
    }
    commit(batch as Batch);
  }

  return {
    store,
    load,
    commit,
    async flush() {
      while (pending.size) await Promise.all([...pending]);
    },
    dispose() {
      channel?.close();
      channel = null;
    },
  };
}
