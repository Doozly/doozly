import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { INBOX_ID, type RepeatRule } from "../../data/model.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";
import { describeRepeat } from "./repeatLabel.ts";

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

async function openTask(
  fields: { dueDate?: string; repeat?: RepeatRule } = {},
) {
  const app = await renderApp("/lists/inbox", (a) =>
    a.addTask(INBOX_ID, "Bins out", fields),
  );
  await userEvent.click(screen.getByRole("link", { name: "Bins out" }));
  const pane = screen.getByRole("complementary", { name: "Task details" });
  const tasks = () => Object.values(app.state().tasks);
  const task = () => tasks()[0];
  return { ...app, pane, task, tasks };
}

async function pick(pane: HTMLElement, current: string, item: string) {
  await userEvent.click(within(pane).getByRole("button", { name: current }));
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
}

test("labels read like To Do's", () => {
  expect(describeRepeat({ unit: "day", interval: 1 })).toBe("Daily");
  expect(describeRepeat({ unit: "day", interval: 3 })).toBe("Every 3 days");
  expect(
    describeRepeat({ unit: "week", interval: 1, weekdays: [5, 4, 3, 2, 1] }),
  ).toBe("Weekdays");
  expect(describeRepeat({ unit: "week", interval: 1, weekdays: [4] })).toBe(
    "Weekly",
  );
  expect(
    describeRepeat({ unit: "week", interval: 2, weekdays: [0, 3, 1] }),
  ).toBe("Every 2 weeks, Mon, Wed, Sun");
  expect(describeRepeat({ unit: "month", interval: 1, monthDay: 31 })).toBe(
    "Monthly",
  );
  expect(describeRepeat({ unit: "year", interval: 1 })).toBe("Yearly");
  expect(describeRepeat({ unit: "year", interval: 2 })).toBe("Every 2 years");
});

test("a preset sets the rule, and due today when there was no due date", async () => {
  const { pane, task } = await openTask();
  await pick(pane, "Repeat", "Weekly");
  expect(task()?.repeat).toEqual({ unit: "week", interval: 1, weekdays: [4] });
  expect(task()?.dueDate).toBe("2026-11-19");
  expect(within(pane).getByRole("button", { name: "Weekly" })).toBeVisible();
});

test("an existing due date stays and anchors the month", async () => {
  const { pane, task } = await openTask({ dueDate: "2026-12-31" });
  await pick(pane, "Repeat", "Monthly");
  expect(task()).toMatchObject({
    dueDate: "2026-12-31",
    repeat: { unit: "month", interval: 1, monthDay: 31 },
  });
});

test("weekdays from a Saturday start on Monday", async () => {
  vi.setSystemTime(new Date(2026, 10, 21, 12));
  const { pane, task } = await openTask();
  await pick(pane, "Repeat", "Weekdays");
  expect(task()?.dueDate).toBe("2026-11-23");
});

test("never repeat and the cross both take it off", async () => {
  const { pane, task } = await openTask({
    dueDate: "2026-11-19",
    repeat: { unit: "day", interval: 1 },
  });
  await pick(pane, "Daily", "Never repeat");
  expect(task()?.repeat).toBeNull();
  expect(task()?.dueDate).toBe("2026-11-19");

  await pick(pane, "Repeat", "Daily");
  await userEvent.click(
    within(pane).getByRole("button", { name: "Never repeat" }),
  );
  expect(task()?.repeat).toBeNull();
});

test("custom: every 2 weeks on Monday and Wednesday", async () => {
  const { pane, task } = await openTask();
  await pick(pane, "Repeat", "Custom");
  const dialog = await screen.findByRole("dialog", { name: "Repeat every…" });
  const interval = within(dialog).getByRole("spinbutton", { name: "Interval" });
  await userEvent.clear(interval);
  await userEvent.type(interval, "2");
  expect(within(dialog).getByRole("combobox", { name: "Unit" })).toHaveValue(
    "week",
  );
  // Thursday is picked to begin with, today being one
  const thursday = within(dialog).getByRole("button", { name: "Thursday" });
  expect(thursday).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(within(dialog).getByRole("button", { name: "Monday" }));
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Wednesday" }),
  );
  await userEvent.click(thursday);
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  expect(task()?.repeat).toEqual({
    unit: "week",
    interval: 2,
    weekdays: [1, 3],
  });
  expect(task()?.dueDate).toBe("2026-11-23");
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Repeat every…" })).toBeNull(),
  );
  expect(
    within(pane).getByRole("button", { name: "Every 2 weeks, Mon, Wed" }),
  ).toBeVisible();
});

test("custom: the last day can't be unpicked, and days hide for months", async () => {
  const { pane, task } = await openTask({ dueDate: "2026-11-30" });
  await pick(pane, "Repeat", "Custom");
  const dialog = await screen.findByRole("dialog", { name: "Repeat every…" });
  const monday = within(dialog).getByRole("button", { name: "Monday" });
  await userEvent.click(monday);
  expect(monday).toHaveAttribute("aria-pressed", "true");

  await userEvent.selectOptions(
    within(dialog).getByRole("combobox", { name: "Unit" }),
    "month",
  );
  expect(within(dialog).queryByRole("group")).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(task()?.repeat).toEqual({ unit: "month", interval: 1, monthDay: 30 });
});

test("ticking it off leaves the next one, with the repeat icon on its row", async () => {
  const { pane, tasks } = await openTask({
    dueDate: "2026-11-19",
    repeat: { unit: "day", interval: 1 },
  });
  await userEvent.click(
    within(pane).getByRole("checkbox", { name: "Bins out" }),
  );

  await waitFor(() => expect(tasks()).toHaveLength(2));
  const next = tasks().find((t) => t.completedAt === null);
  expect(next?.dueDate).toBe("2026-11-20");
  const rows = screen
    .getAllByRole("link", { name: "Bins out" })
    .map((l) => l.closest("li"));
  const open = rows.find((r) => r?.textContent?.includes("Tomorrow"));
  expect(open).toHaveTextContent("repeats");
});
