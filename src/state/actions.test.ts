// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import { loadAll } from "../data/db.ts";
import { INBOX_ID } from "../data/model.ts";
import { testApp } from "../test/app.ts";
import { setting } from "./actions.ts";
import { byPosition } from "./position.ts";
import type { AppState } from "./store.ts";

const titlesIn = (state: AppState, listId: string) =>
  Object.values(state.tasks)
    .filter((t) => t.listId === listId && t.deletedAt === null)
    .sort(byPosition)
    .map((t) => t.title);

test("new tasks go on top by default, at the bottom when that's turned off", async () => {
  const { actions, state } = await testApp();
  actions.addTask(INBOX_ID, "First");
  actions.addTask(INBOX_ID, "Second");
  expect(titlesIn(state(), INBOX_ID)).toEqual(["Second", "First"]);

  actions.setSetting("addNewTasksOnTop", false);
  actions.addTask(INBOX_ID, "Third");
  expect(titlesIn(state(), INBOX_ID)).toEqual(["Second", "First", "Third"]);
});

test("titles get trimmed and empty ones are ignored", async () => {
  const { actions, state } = await testApp();
  expect(actions.addTask(INBOX_ID, "   ")).toBeNull();
  expect(actions.addTask(INBOX_ID, "  Milk ")?.title).toBe("Milk");
  expect(titlesIn(state(), INBOX_ID)).toEqual(["Milk"]);
});

test("extra fields go along, like when adding from My Day", async () => {
  const { actions } = await testApp();
  const t = actions.addTask(INBOX_ID, "Call mum", { myDay: "2026-11-19" });
  expect(t?.myDay).toBe("2026-11-19");
});

test("complete and important toggle back and forth", async () => {
  const { actions, state } = await testApp();
  const t = actions.addTask(INBOX_ID, "Milk");
  if (!t) throw new Error("no task");
  actions.toggleCompleted(t.id);
  actions.toggleImportant(t.id);
  expect(state().tasks[t.id]).toMatchObject({ important: true });
  expect(state().tasks[t.id]?.completedAt).toBeTypeOf("number");
  actions.toggleCompleted(t.id);
  expect(state().tasks[t.id]?.completedAt).toBeNull();
});

test("deleting a task takes its steps, and undo brings both back", async () => {
  const { actions, state } = await testApp();
  const t = actions.addTask(INBOX_ID, "Shop");
  if (!t) throw new Error("no task");
  const s = actions.addStep(t.id, "Bread");
  const undo = actions.deleteTask(t.id);
  expect(state().tasks[t.id]?.deletedAt).not.toBeNull();
  expect(s && state().steps[s.id]?.deletedAt).not.toBeNull();

  undo?.();
  expect(state().tasks[t.id]?.deletedAt).toBeNull();
  expect(s && state().steps[s.id]?.deletedAt).toBeNull();
});

test("deleted things can't be edited", async () => {
  const { actions } = await testApp();
  const t = actions.addTask(INBOX_ID, "Gone");
  if (!t) throw new Error("no task");
  actions.deleteTask(t.id);
  expect(actions.updateTask(t.id, { title: "Back?" })).toBeNull();
  expect(actions.toggleCompleted(t.id)).toBeNull();
  expect(actions.addStep(t.id, "Nope")).toBeNull();
});

test("moveTask puts it between the given neighbours", async () => {
  const { actions, state } = await testApp();
  actions.setSetting("addNewTasksOnTop", false);
  const [a, b, c] = ["A", "B", "C"].map((n) => actions.addTask(INBOX_ID, n));
  if (!a || !b || !c) throw new Error("no tasks");
  actions.moveTask(c.id, { prevId: a.id, nextId: b.id });
  expect(titlesIn(state(), INBOX_ID)).toEqual(["A", "C", "B"]);
  actions.moveTask(a.id, { prevId: b.id, nextId: null });
  expect(titlesIn(state(), INBOX_ID)).toEqual(["C", "B", "A"]);
});

test("moveTask can move to another list", async () => {
  const { actions, state } = await testApp();
  const list = actions.addList("Shopping");
  const t = actions.addTask(INBOX_ID, "Milk");
  if (!t) throw new Error("no task");
  actions.moveTask(t.id, { listId: list.id, prevId: null, nextId: null });
  expect(titlesIn(state(), list.id)).toEqual(["Milk"]);
  expect(titlesIn(state(), INBOX_ID)).toEqual([]);
  expect(
    actions.moveTask(t.id, { listId: "nope", prevId: null, nextId: null }),
  ).toBeNull();
});

test("moveTaskToList puts it where a new task would go", async () => {
  const { actions, state } = await testApp();
  const list = actions.addList("Shopping");
  actions.addTask(list.id, "Bread");
  const milk = actions.addTask(INBOX_ID, "Milk");
  const eggs = actions.addTask(INBOX_ID, "Eggs");
  if (!milk || !eggs) throw new Error("no task");

  actions.moveTaskToList(milk.id, list.id);
  expect(titlesIn(state(), list.id)).toEqual(["Milk", "Bread"]);
  actions.setSetting("addNewTasksOnTop", false);
  actions.moveTaskToList(eggs.id, list.id);
  expect(titlesIn(state(), list.id)).toEqual(["Milk", "Bread", "Eggs"]);

  expect(actions.moveTaskToList(eggs.id, list.id)).toBeNull();
  expect(actions.moveTaskToList(eggs.id, "nope")).toBeNull();
});

test("steps get added at the bottom and toggle", async () => {
  const { actions, state } = await testApp();
  const t = actions.addTask(INBOX_ID, "Shop");
  if (!t) throw new Error("no task");
  const one = actions.addStep(t.id, "Bread");
  const two = actions.addStep(t.id, "Butter");
  if (!one || !two) throw new Error("no steps");
  expect(two.position > one.position).toBe(true);
  actions.toggleStep(one.id);
  expect(state().steps[one.id]?.completedAt).toBeTypeOf("number");
  actions.moveStep(two.id, { prevId: null, nextId: one.id });
  expect(state().steps[two.id]?.position).toSatisfy(
    (p: string) => p < one.position,
  );
});

test("new lists go to the bottom of the sidebar", async () => {
  const { actions, state } = await testApp();
  const a = actions.addList("A");
  const b = actions.addList("B");
  const inbox = state().lists[INBOX_ID];
  expect(inbox && a.position > inbox.position).toBe(true);
  expect(b.position > a.position).toBe(true);
});

test("deleting a list takes its tasks and steps along", async () => {
  const { app, actions, state, db } = await testApp();
  const list = actions.addList("Trip");
  const t = actions.addTask(list.id, "Pack");
  if (!t) throw new Error("no task");
  const s = actions.addStep(t.id, "Socks");
  actions.deleteList(list.id);
  expect(state().lists[list.id]?.deletedAt).not.toBeNull();
  expect(state().tasks[t.id]?.deletedAt).not.toBeNull();
  expect(s && state().steps[s.id]?.deletedAt).not.toBeNull();

  await app.flush();
  const disk = await loadAll(db);
  expect(disk.tasks.every((x) => x.deletedAt !== null)).toBe(true);
});

test("the built-in Tasks list can't be deleted or moved", async () => {
  const { actions, state } = await testApp();
  expect(actions.deleteList(INBOX_ID)).toBeNull();
  expect(actions.moveList(INBOX_ID, { prevId: null, nextId: null })).toBeNull();
  expect(state().lists[INBOX_ID]?.deletedAt).toBeNull();
});

test("settings fall back to the defaults until set", async () => {
  const { actions, state } = await testApp();
  expect(setting(state(), "theme")).toBe("system");
  actions.setSetting("theme", "dark");
  expect(setting(state(), "theme")).toBe("dark");
});

test("everything survives a reload", async () => {
  const { app, actions, db } = await testApp();
  const list = actions.addList("Groceries");
  actions.addTask(list.id, "Milk");
  actions.setSetting("theme", "dark");
  await app.flush();
  const disk = await loadAll(db);
  expect(disk.lists.map((l) => l.title)).toContain("Groceries");
  expect(disk.tasks.map((t) => t.title)).toEqual(["Milk"]);
  expect(disk.settings).toEqual([expect.objectContaining({ value: "dark" })]);
});

test("duplicating a list copies it right below, with fresh ids for everything", async () => {
  const { actions, state } = await testApp();
  const original = actions.addList("Groceries", { accent: "green" });
  const after = actions.addList("Holiday");
  const milk = actions.addTask(original.id, "Milk");
  const bread = actions.addTask(original.id, "Bread");
  if (!milk || !bread) throw new Error("no tasks");
  actions.toggleCompleted(bread.id);
  const step = actions.addStep(milk.id, "Oat");

  const copy = actions.duplicateList(original.id);
  if (!copy) throw new Error("no copy");
  expect(copy).toMatchObject({ title: "Groceries (1)", accent: "green" });
  expect(copy.id).not.toBe(original.id);
  expect(copy.position > original.position).toBe(true);
  expect(copy.position < after.position).toBe(true);

  const copied = Object.values(state().tasks).filter(
    (t) => t.listId === copy.id,
  );
  expect(copied.map((t) => t.title).sort()).toEqual(["Bread", "Milk"]);
  expect(copied.every((t) => t.id !== milk.id && t.id !== bread.id)).toBe(true);
  expect(copied.find((t) => t.title === "Bread")?.completedAt).not.toBeNull();

  const milkCopy = copied.find((t) => t.title === "Milk");
  const stepCopies = Object.values(state().steps).filter(
    (s) => s.taskId === milkCopy?.id,
  );
  expect(stepCopies.map((s) => s.title)).toEqual(["Oat"]);
  expect(stepCopies[0]?.id).not.toBe(step?.id);

  // The original keeps its own tasks
  expect(titlesIn(state(), original.id)).toEqual(["Bread", "Milk"]);
});

test("duplicating leaves deleted tasks behind", async () => {
  const { actions, state } = await testApp();
  const list = actions.addList("Trip");
  const gone = actions.addTask(list.id, "Gone");
  if (gone) actions.deleteTask(gone.id);
  const copy = actions.duplicateList(list.id);
  expect(
    Object.values(state().tasks).filter((t) => t.listId === copy?.id),
  ).toEqual([]);
});

test("My Day holds a task only on the day it was added", async () => {
  const { actions, state } = await testApp();
  const t = actions.addTask(INBOX_ID, "Call mum");
  if (!t) throw new Error("no task");
  actions.toggleMyDay(t.id, "2026-11-19");
  expect(state().tasks[t.id]?.myDay).toBe("2026-11-19");
  // Next day it reads as not in My Day, so toggling adds it again for that day
  actions.toggleMyDay(t.id, "2026-11-20");
  expect(state().tasks[t.id]?.myDay).toBe("2026-11-20");
  actions.toggleMyDay(t.id, "2026-11-20");
  expect(state().tasks[t.id]?.myDay).toBeNull();
});

const sidebarOrder = (state: AppState) => {
  const live = <T extends { deletedAt: number | null }>(r: Record<string, T>) =>
    Object.values(r).filter((x) => x.deletedAt === null);
  const top = [
    ...live(state.lists).filter((l) => l.groupId === null),
    ...live(state.groups),
  ].sort(byPosition);
  return top.map((x) =>
    "groupId" in x
      ? x.title
      : `${x.title}[${live(state.lists)
          .filter((l) => l.groupId === x.id)
          .sort(byPosition)
          .map((l) => l.title)
          .join(",")}]`,
  );
};

test("lists move into a group at its end, and back out to the end", async () => {
  const { actions, state } = await testApp();
  const a = actions.addList("A");
  const b = actions.addList("B");
  const home = actions.addGroup("Home");
  actions.moveListToGroup(a.id, home.id);
  actions.moveListToGroup(b.id, home.id);
  expect(sidebarOrder(state())).toEqual(["Tasks", "Home[A,B]"]);

  actions.moveListToGroup(a.id, null);
  expect(sidebarOrder(state())).toEqual(["Tasks", "Home[B]", "A"]);
  expect(actions.moveListToGroup(a.id, "nope")).toBeNull();
  expect(actions.moveListToGroup(INBOX_ID, home.id)).toBeNull();
});

test("groups reorder among the top-level lists", async () => {
  const { actions, state } = await testApp();
  const a = actions.addList("A");
  const home = actions.addGroup("Home");
  actions.moveGroup(home.id, { prevId: INBOX_ID, nextId: a.id });
  expect(sidebarOrder(state())).toEqual(["Tasks", "Home[]", "A"]);
  expect(actions.moveGroup("nope", { prevId: null, nextId: null })).toBeNull();
});

test("ungrouping puts the lists where the group was, in order", async () => {
  const { actions, state } = await testApp();
  actions.addList("Before");
  const home = actions.addGroup("Home");
  actions.addList("After");
  const x = actions.addList("X");
  const y = actions.addList("Y");
  actions.moveListToGroup(x.id, home.id);
  actions.moveListToGroup(y.id, home.id);
  expect(sidebarOrder(state())).toEqual([
    "Tasks",
    "Before",
    "Home[X,Y]",
    "After",
  ]);

  actions.ungroup(home.id);
  expect(sidebarOrder(state())).toEqual(["Tasks", "Before", "X", "Y", "After"]);
  expect(state().groups[home.id]?.deletedAt).not.toBeNull();
});

test("only an empty group can be deleted, and groups rename", async () => {
  const { actions, state } = await testApp();
  const home = actions.addGroup("Home");
  const list = actions.addList("A");
  actions.moveListToGroup(list.id, home.id);
  expect(actions.deleteGroup(home.id)).toBeNull();

  actions.updateGroup(home.id, { title: "House" });
  expect(state().groups[home.id]?.title).toBe("House");

  actions.moveListToGroup(list.id, null);
  expect(actions.deleteGroup(home.id)).not.toBeNull();
  expect(state().groups[home.id]?.deletedAt).not.toBeNull();
});

test("an import merges like a sync: new things land, newer edits win, nothing doubles", async () => {
  const source = await testApp();
  const list = source.actions.addList("Groceries");
  const milk = source.actions.addTask(list.id, "Milk");
  source.actions.addTask(list.id, "Bread");
  await source.app.flush();
  const backup = await loadAll(source.db);
  if (!milk) throw new Error("no task");

  // Another device: a database of its own
  globalThis.indexedDB = new IDBFactory();
  const { actions, state } = await testApp();
  expect(actions.importSnapshot(backup)).toMatchObject({ lists: 1, tasks: 2 });
  expect(titlesIn(state(), list.id).sort()).toEqual(["Bread", "Milk"]);
  expect(state().lists[INBOX_ID]).toBeDefined();

  // The same file again changes nothing
  expect(actions.importSnapshot(backup)).toBeNull();

  // An edit made here after the export stays
  actions.updateTask(milk.id, { title: "Oat milk" });
  expect(actions.importSnapshot(backup)).toBeNull();
  expect(state().tasks[milk.id]?.title).toBe("Oat milk");
});

test("undo takes an import back out", async () => {
  const source = await testApp();
  const list = source.actions.addList("Groceries");
  source.actions.addTask(list.id, "Milk");
  await source.app.flush();
  const backup = await loadAll(source.db);

  globalThis.indexedDB = new IDBFactory();
  const { actions, state } = await testApp();
  actions.importSnapshot(backup)?.undo();
  expect(state().lists[list.id]?.deletedAt).not.toBeNull();
  expect(titlesIn(state(), list.id)).toEqual([]);
});
