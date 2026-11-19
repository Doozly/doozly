import type { Stamp } from "../data/clock.ts";
import type { Batch, Snapshot } from "../data/db.ts";
import type { List } from "../data/model.ts";
import { type ListFile, SCHEMA_VERSION } from "./files.ts";

/** Tombstones stay this long, so devices that were offline a while still hear about the delete */
export const RETENTION_MS = 30 * 24 * 3_600_000;

type Stamped = { updatedAt: Stamp };

/** Same content gives the same text, whatever order the keys came in */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}

const same = (a: Stamped, b: Stamped) =>
  a.updatedAt === b.updatedAt && canonical(a) === canonical(b);

/**
 * Last writer wins, deletes included: a delete is a write with a tombstone.
 * Equal stamps should mean the same write; if not, the content decides, the same on every device.
 */
export function newer<T extends Stamped>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return canonical(a) >= canonical(b) ? a : b;
}

function mergeBy<T extends Stamped>(
  key: (r: T) => string,
  a: readonly T[],
  b: readonly T[],
): T[] {
  const out = new Map<string, T>();
  for (const r of [...a, ...b]) {
    const have = out.get(key(r));
    out.set(key(r), have ? newer(have, r) : r);
  }
  // Sorted by key, so the result doesn't depend on which side came first
  return [...out.values()].sort((x, y) =>
    key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0,
  );
}

const byId = (r: { id: string }) => r.id;
const byKey = (r: { key: string }) => r.key;

/** Everything from both sides, the newer version of each record. Order of arguments doesn't matter. */
export function mergeSnapshots(a: Snapshot, b: Snapshot): Snapshot {
  return {
    lists: mergeBy(byId, a.lists, b.lists),
    groups: mergeBy(byId, a.groups, b.groups),
    tasks: mergeBy(byId, a.tasks, b.tasks),
    steps: mergeBy(byId, a.steps, b.steps),
    settings: mergeBy(byKey, a.settings, b.settings),
  };
}

/** The records in `merged` that `side` doesn't have yet, like what to write locally or push */
export function changes(side: Snapshot, merged: Snapshot): Batch {
  const missing = <T extends Stamped>(
    key: (r: T) => string,
    have: readonly T[],
    want: readonly T[],
  ) => {
    const known = new Map(have.map((r) => [key(r), r]));
    return want.filter((r) => {
      const k = known.get(key(r));
      return !k || !same(k, r);
    });
  };
  const batch: Batch = {
    lists: missing(byId, side.lists, merged.lists),
    groups: missing(byId, side.groups, merged.groups),
    tasks: missing(byId, side.tasks, merged.tasks),
    steps: missing(byId, side.steps, merged.steps),
    settings: missing(byKey, side.settings, merged.settings),
  };
  for (const k of Object.keys(batch) as (keyof Batch)[]) {
    if (batch[k]?.length === 0) delete batch[k];
  }
  return batch;
}

/** Drops tombstones older than the retention window. Live records always stay. */
export function prune(
  s: Snapshot,
  now = Date.now(),
  retention = RETENTION_MS,
): Snapshot {
  const keep = <T extends { deletedAt: number | null }>(rows: T[]) =>
    rows.filter((r) => r.deletedAt === null || now - r.deletedAt <= retention);
  return {
    lists: keep(s.lists),
    groups: keep(s.groups),
    tasks: keep(s.tasks),
    steps: keep(s.steps),
    settings: s.settings,
  };
}

/** The newest stamp in there, for the clock to take in after a pull */
export function latestStamp(s: Partial<Snapshot>): Stamp | null {
  let latest: Stamp | null = null;
  for (const rows of Object.values(s) as Stamped[][]) {
    for (const r of rows ?? []) {
      if (latest === null || r.updatedAt > latest) latest = r.updatedAt;
    }
  }
  return latest;
}

/** What goes into a list's file: the list, its tasks (tombstones too) and their steps */
export function listFileFor(
  list: List,
  s: Pick<Snapshot, "tasks" | "steps">,
): ListFile {
  const tasks = s.tasks.filter((t) => t.listId === list.id);
  const ids = new Set(tasks.map((t) => t.id));
  return {
    schema: SCHEMA_VERSION,
    list,
    tasks: [...tasks].sort((a, b) => (a.id < b.id ? -1 : 1)),
    steps: s.steps
      .filter((st) => ids.has(st.taskId))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

/**
 * Two versions of the same list's file, like ours and the one on the server.
 * Keeps everything either side has; a task that moved to another list stays in
 * here until `listFileFor` writes the file again.
 */
export function mergeListFiles(a: ListFile, b: ListFile): ListFile {
  if (a.list.id !== b.list.id) {
    throw new Error(
      `Can't merge files of two lists: ${a.list.id}, ${b.list.id}`,
    );
  }
  return {
    schema: SCHEMA_VERSION,
    list: newer(a.list, b.list),
    tasks: mergeBy(byId, a.tasks, b.tasks),
    steps: mergeBy(byId, a.steps, b.steps),
  };
}
