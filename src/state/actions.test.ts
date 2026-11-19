// @vitest-environment node
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
