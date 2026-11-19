import fc from "fast-check";
import { expect, test } from "vitest";
import { createClock } from "../data/clock.ts";
import type { Snapshot } from "../data/db.ts";
import {
  createGroup,
  createList,
  createStep,
  createTask,
  type SettingRecord,
} from "../data/model.ts";
import {
  changes,
  latestStamp,
  listFileFor,
  mergeListFiles,
  mergeSnapshots,
  newer,
  prune,
  RETENTION_MS,
} from "./merge.ts";

const NOW = Date.UTC(2026, 10, 19, 12);

// A small pool of ids and stamps, so the same record often shows up on both sides
const id = fc.constantFrom("a", "b", "c", "d");
const at = fc
  .record({
    ms: fc.integer({ min: 0, max: 5 }),
    counter: fc.integer({ min: 0, max: 2 }),
    node: fc.constantFrom("n1", "n2"),
  })
  .map(
    ({ ms, counter, node }) =>
      `${String(NOW + ms).padStart(13, "0")}:${counter.toString(36).padStart(4, "0")}:${node}`,
  );
const deletedAt = fc.option(
  fc.integer({ min: NOW - 2 * RETENTION_MS, max: NOW }),
  {
    nil: null,
  },
);
const text = fc.constantFrom("Milk", "Bread", "Eggs");

const task = fc
  .record({
    id,
    updatedAt: at,
    deletedAt,
    title: text,
    listId: fc.constantFrom("l1", "l2"),
  })
  .map((f) => createTask({ ...f, position: "a0", createdAt: NOW }));
const step = fc
  .record({ id, updatedAt: at, deletedAt, title: text, taskId: id })
  .map((f) => createStep({ ...f, position: "a0", createdAt: NOW }));
const list = fc
  .record({ id, updatedAt: at, deletedAt, title: text })
  .map((f) => createList({ ...f, position: "a0", createdAt: NOW }));
const group = fc
  .record({ id, updatedAt: at, deletedAt, title: text })
  .map((f) => createGroup({ ...f, position: "a0", createdAt: NOW }));
const setting = fc
  .record({
    key: fc.constantFrom("confirmBeforeDelete", "playCompletionSound"),
    value: fc.boolean(),
    updatedAt: at,
  })
  .map((r) => r as SettingRecord);

const snapshot: fc.Arbitrary<Snapshot> = fc.record({
  lists: fc.array(list, { maxLength: 6 }),
  groups: fc.array(group, { maxLength: 4 }),
  tasks: fc.array(task, { maxLength: 8 }),
  steps: fc.array(step, { maxLength: 8 }),
  settings: fc.array(setting, { maxLength: 4 }),
});

const empty: Snapshot = {
  lists: [],
  groups: [],
  tasks: [],
  steps: [],
  settings: [],
};

test("property: merging is commutative", () => {
  fc.assert(
    fc.property(snapshot, snapshot, (a, b) => {
      expect(mergeSnapshots(a, b)).toEqual(mergeSnapshots(b, a));
    }),
  );
});

test("property: merging is associative", () => {
  fc.assert(
    fc.property(snapshot, snapshot, snapshot, (a, b, c) => {
      expect(mergeSnapshots(mergeSnapshots(a, b), c)).toEqual(
        mergeSnapshots(a, mergeSnapshots(b, c)),
      );
    }),
  );
});

test("property: merging again changes nothing", () => {
  fc.assert(
    fc.property(snapshot, snapshot, (a, b) => {
      const once = mergeSnapshots(a, b);
      expect(mergeSnapshots(once, b)).toEqual(once);
      expect(mergeSnapshots(once, once)).toEqual(once);
      expect(mergeSnapshots(a, a)).toEqual(mergeSnapshots(a, empty));
    }),
  );
});

test("property: each record is the newest one either side had", () => {
  fc.assert(
    fc.property(snapshot, snapshot, (a, b) => {
      const merged = mergeSnapshots(a, b);
      for (const t of merged.tasks) {
        const versions = [...a.tasks, ...b.tasks].filter((x) => x.id === t.id);
        expect(versions).toContain(t);
        for (const v of versions) expect(t.updatedAt >= v.updatedAt).toBe(true);
      }
      const ids = new Set([...a.tasks, ...b.tasks].map((t) => t.id));
      expect(new Set(merged.tasks.map((t) => t.id))).toEqual(ids);
    }),
  );
});

test("property: after writing the changes, both sides end up the same", () => {
  fc.assert(
    fc.property(snapshot, snapshot, (local, remote) => {
      const merged = mergeSnapshots(local, remote);
      const apply = (side: Snapshot) =>
        mergeSnapshots(side, { ...empty, ...changes(side, merged) });
      expect(apply(local)).toEqual(merged);
      expect(apply(remote)).toEqual(merged);
      expect(changes(merged, merged)).toEqual({});
    }),
  );
});

test("property: pruning drops only old tombstones", () => {
  fc.assert(
    fc.property(snapshot, (s) => {
      const pruned = prune(s, NOW);
      for (const t of s.tasks) {
        const kept = pruned.tasks.includes(t);
        const old = t.deletedAt !== null && NOW - t.deletedAt > RETENTION_MS;
        expect(kept).toBe(!old);
      }
      expect(pruned.settings).toEqual(s.settings);
    }),
  );
});

test("delete vs edit: whichever came later wins, both ways round", () => {
  const base = createTask({
    id: "t",
    listId: "l",
    title: "Milk",
    position: "a0",
  });
  const edit = {
    ...base,
    title: "Oat milk",
    updatedAt: "0000000000002:0000:n1",
  };
  const del = { ...base, deletedAt: NOW, updatedAt: "0000000000003:0000:n2" };
  expect(newer(edit, del)).toBe(del);
  expect(newer(del, edit)).toBe(del);

  const lateEdit = { ...edit, updatedAt: "0000000000004:0000:n1" };
  expect(newer(lateEdit, del)).toBe(lateEdit);
  expect(newer(del, lateEdit)).toBe(lateEdit);
});

test("clock skew: an edit made after seeing a change wins, even on a slow clock", () => {
  const ahead = createClock("ahead000");
  const behind = createClock("behind00");
  const hour = 3_600_000;

  const theirs = createTask({
    id: "t",
    listId: "l",
    title: "From the fast device",
    position: "a0",
    updatedAt: ahead.stamp(NOW),
  });
  // The slow device pulls, takes in the stamps, then edits
  const pulled = { ...empty, tasks: [theirs] };
  const latest = latestStamp(pulled);
  if (latest) behind.receive(latest, NOW - hour);
  const ours = {
    ...theirs,
    title: "Edited later",
    updatedAt: behind.stamp(NOW - hour),
  };

  const merged = mergeSnapshots(pulled, { ...empty, tasks: [ours] });
  expect(merged.tasks[0]?.title).toBe("Edited later");
});

test("list files merge per task, and a moved task leaves its old file on rewrite", () => {
  const list = createList({ id: "l1", title: "Shopping", position: "a0" });
  const milk = createTask({
    id: "m",
    listId: "l1",
    title: "Milk",
    position: "a0",
    updatedAt: "0000000000001:0000:n1",
  });
  const bread = createTask({
    id: "b",
    listId: "l1",
    title: "Bread",
    position: "a1",
    updatedAt: "0000000000001:0000:n1",
  });
  const step = createStep({
    id: "s",
    taskId: "m",
    title: "Oat",
    position: "a0",
    updatedAt: "0000000000001:0000:n1",
  });

  const ours = listFileFor(list, { tasks: [milk, bread], steps: [step] });
  const movedBread = {
    ...bread,
    listId: "l2",
    updatedAt: "0000000000002:0000:n2",
  };
  const editedMilk = {
    ...milk,
    title: "Oat milk",
    updatedAt: "0000000000003:0000:n2",
  };
  const theirs = { ...ours, tasks: [editedMilk, movedBread] };

  const merged = mergeListFiles(ours, theirs);
  expect(merged).toEqual(mergeListFiles(theirs, ours));
  expect(merged.tasks.map((t) => t.title).sort()).toEqual([
    "Bread",
    "Oat milk",
  ]);
  expect(merged.steps).toEqual([step]);

  const rewritten = listFileFor(merged.list, merged);
  expect(rewritten.tasks.map((t) => t.id)).toEqual(["m"]);
  expect(() =>
    mergeListFiles(ours, { ...ours, list: { ...list, id: "other" } }),
  ).toThrow();
});
