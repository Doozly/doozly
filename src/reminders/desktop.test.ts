import { expect, test, vi } from "vitest";
import { createDesktopScheduler } from "./desktop.ts";
import type { Reminder } from "./reminders.ts";

const milk: Reminder = {
  id: "t1@1000",
  taskId: "t1",
  listId: "inbox",
  fireAt: 1000,
  title: "Milk",
  body: "Tasks",
};

test("the whole set goes to the Rust side with the task's path, and only when it changed", async () => {
  const invoke = vi.fn(async () => {});
  const s = createDesktopScheduler(
    invoke,
    (r) => `/lists/${r.listId}/tasks/${r.taskId}`,
  );
  await s.sync([milk]);
  await s.sync([{ ...milk }]);
  expect(invoke).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("set_reminders", {
    reminders: [
      {
        id: "t1@1000",
        fireAt: 1000,
        title: "Milk",
        body: "Tasks",
        path: "/lists/inbox/tasks/t1",
      },
    ],
  });
  await s.sync([]);
  expect(invoke).toHaveBeenLastCalledWith("set_reminders", { reminders: [] });
});
