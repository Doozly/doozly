import { expect, test } from "vitest";
import { createInbox, createStep, createTask, INBOX_ID } from "./model.ts";

test("new records get an id, stamps and no tombstone", () => {
  const a = createTask({ listId: INBOX_ID, title: "Milk", position: "a0" });
  const b = createTask({ listId: INBOX_ID, title: "Eggs", position: "a1" });
  expect(a.id).not.toBe(b.id);
  expect(b.updatedAt > a.updatedAt).toBe(true);
  expect(a.deletedAt).toBeNull();
  expect(a).toMatchObject({ completedAt: null, important: false, note: "" });
});

test("given fields win over the defaults", () => {
  const step = createStep({
    taskId: "t1",
    title: "Done already",
    position: "a0",
    completedAt: 123,
  });
  expect(step.completedAt).toBe(123);
});

test("the inbox has the same id everywhere", () => {
  expect(createInbox().id).toBe(INBOX_ID);
  expect(createInbox().title).toBe("Tasks");
});
