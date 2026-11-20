// @vitest-environment node
import { expect, test } from "vitest";
import { createInbox, createList, createTask } from "../data/model.ts";
import { pendingReminders } from "./reminders.ts";

test("only open tasks in live lists, soonest first, with the list's name", () => {
  const inbox = createInbox();
  const gone = {
    ...createList({ title: "Old", position: "a1" }),
    deletedAt: 1,
  };
  const task = (title: string, fields = {}) =>
    createTask({ listId: inbox.id, title, position: "a0", ...fields });
  const tasks = [
    task("Later", { reminderAt: 2000 }),
    task("Soon", { reminderAt: 1000 }),
    task("No reminder"),
    task("Done", { reminderAt: 1500, completedAt: 1 }),
    task("Deleted", { reminderAt: 1500, deletedAt: 1 }),
    task("In a deleted list", { reminderAt: 1500, listId: gone.id }),
  ];

  const set = pendingReminders(
    Object.fromEntries(tasks.map((t) => [t.id, t])),
    { [inbox.id]: inbox, [gone.id]: gone },
  );
  expect(set.map((r) => [r.title, r.body, r.fireAt])).toEqual([
    ["Soon", "Tasks", 1000],
    ["Later", "Tasks", 2000],
  ]);
  expect(set[0]?.id).toBe(`${tasks[1]?.id}@1000`);
});
