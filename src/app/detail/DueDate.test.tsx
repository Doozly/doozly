import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

beforeEach(() => {
  // Thursday 19 November 2026, midday. Only Date is faked, timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 19, 12));
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    completedFolded: {},
    renamingListId: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function openTask(dueDate: string | null = null) {
  const app = await renderApp("/lists/inbox", (a) =>
    a.addTask(INBOX_ID, "Pay rent", { dueDate }),
  );
  await userEvent.click(screen.getByRole("link", { name: "Pay rent" }));
  const pane = screen.getByRole("complementary", { name: "Task details" });
  const task = () => Object.values(app.state().tasks)[0];
  const row = () =>
    screen.getByRole("link", { name: "Pay rent" }).closest("li");
  return { ...app, pane, task, row };
}

async function pick(pane: HTMLElement, item: string) {
  await userEvent.click(
    within(pane).getByRole("button", { name: /^(Add due date|Due )/ }),
  );
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
}

test("quick picks set today, tomorrow and next Monday", async () => {
  const { pane, task, row } = await openTask();
  expect(
    within(pane).getByRole("button", { name: "Add due date" }),
  ).toBeVisible();

  await pick(pane, "Today Thu");
  expect(task()?.dueDate).toBe("2026-11-19");
  expect(within(pane).getByRole("button", { name: "Due today" })).toBeVisible();
  expect(row()).toHaveTextContent("Due Today");

  await pick(pane, "Tomorrow Fri");
  expect(task()?.dueDate).toBe("2026-11-20");
  expect(row()).toHaveTextContent("Tomorrow");

  await pick(pane, "Next week Mon");
  expect(task()?.dueDate).toBe("2026-11-23");
  expect(
    within(pane).getByRole("button", { name: "Due Mon 23 November" }),
  ).toBeVisible();
});

test("the calendar picks any day", async () => {
  const { pane, task } = await openTask();
  await pick(pane, "Pick a date");
  const calendar = await screen.findByRole("application", { name: /Due date/ });
  await userEvent.click(
    within(calendar).getByRole("button", { name: /27 November 2026/ }),
  );
  expect(task()?.dueDate).toBe("2026-11-27");
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Pick a due date" }),
    ).toBeNull(),
  );
});

test("the cross removes it", async () => {
  const { pane, task } = await openTask("2026-11-25");
  await userEvent.click(
    within(pane).getByRole("button", { name: "Remove due date" }),
  );
  expect(task()?.dueDate).toBeNull();
});

test("overdue shows on the row, but not once it's done", async () => {
  const { row, actions, task } = await openTask("2026-11-17");
  const due = () => row()?.querySelector("[data-overdue]");
  expect(due()).not.toBeNull();
  expect(row()).toHaveTextContent("overdue");
  const id = task()?.id ?? "";
  act(() => {
    actions.toggleCompleted(id);
  });
  await waitFor(() => expect(due()).toBeNull());
});

test("the row menu has Due today and Remove due date", async () => {
  const { task } = await openTask();
  fireEvent.contextMenu(screen.getByRole("link", { name: "Pay rent" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Due today" }),
  );
  expect(task()?.dueDate).toBe("2026-11-19");

  fireEvent.contextMenu(screen.getByRole("link", { name: "Pay rent" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Remove due date" }),
  );
  expect(task()?.dueDate).toBeNull();
});
