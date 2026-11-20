import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

class FakeNotification {
  static permission: NotificationPermission = "default";
  static answer: NotificationPermission = "granted";
  static shown: FakeNotification[] = [];
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = FakeNotification.answer;
    return FakeNotification.answer;
  });
  onclick: (() => void) | null = null;
  title: string;
  options: NotificationOptions;
  constructor(title: string, options: NotificationOptions) {
    this.title = title;
    this.options = options;
    FakeNotification.shown.push(this);
  }
  close() {}
}

beforeEach(() => {
  FakeNotification.permission = "default";
  FakeNotification.answer = "granted";
  FakeNotification.shown = [];
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    completedFolded: {},
    renamingListId: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openTask(reminderAt: number | null = null) {
  const app = await renderApp("/lists/inbox", (a) =>
    a.addTask(INBOX_ID, "Call the dentist", { reminderAt }),
  );
  await userEvent.click(screen.getByRole("link", { name: "Call the dentist" }));
  const pane = screen.getByRole("complementary", { name: "Task details" });
  const task = () => Object.values(app.state().tasks)[0];
  const row = () =>
    screen.getByRole("link", { name: "Call the dentist" }).closest("li");
  return { ...app, pane, task, row };
}

function atNoonOnThursday() {
  // Thursday 19 November 2026, midday. Only Date is faked, timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 19, 12));
}

test("quick picks set later today, tomorrow at 9 and Monday at 9", async () => {
  atNoonOnThursday();
  const { pane, task, row } = await openTask();
  const pick = async (current: RegExp, item: string) => {
    await userEvent.click(within(pane).getByRole("button", { name: current }));
    await userEvent.click(await screen.findByRole("menuitem", { name: item }));
  };

  await pick(/^Remind me$/, "Later today 15:00");
  expect(task()?.reminderAt).toBe(new Date(2026, 10, 19, 15).getTime());
  expect(
    within(pane).getByRole("button", { name: "Remind me at 15:00, Today" }),
  ).toBeVisible();
  expect(row()).toHaveTextContent("Reminder Today, 15:00");

  await pick(/^Remind me at/, "Tomorrow Fri 09:00");
  expect(task()?.reminderAt).toBe(new Date(2026, 10, 20, 9).getTime());

  await pick(/^Remind me at/, "Next week Mon 09:00");
  expect(task()?.reminderAt).toBe(new Date(2026, 10, 23, 9).getTime());
  expect(row()).toHaveTextContent("Mon 23 Nov, 09:00");
});

test("the picker takes a day and a time", async () => {
  atNoonOnThursday();
  const { pane, task } = await openTask();
  await userEvent.click(
    within(pane).getByRole("button", { name: "Remind me" }),
  );
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Pick a date & time" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Pick a date & time",
  });
  await userEvent.click(
    within(dialog).getByRole("button", { name: /27 November 2026/ }),
  );
  // The next full hour to begin with
  const hour = within(dialog).getByRole("spinbutton", { name: /hour/i });
  expect(hour).toHaveTextContent("13");
  await userEvent.click(hour);
  await userEvent.keyboard("08");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  expect(task()?.reminderAt).toBe(new Date(2026, 10, 27, 8).getTime());
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Pick a date & time" }),
    ).toBeNull(),
  );
});

test("the cross takes it off", async () => {
  const { pane, task } = await openTask(Date.now() + 3_600_000);
  await userEvent.click(
    within(pane).getByRole("button", { name: "Remove reminder" }),
  );
  expect(task()?.reminderAt).toBeNull();
});

test("setting one asks for notifications, and says so when they're blocked", async () => {
  FakeNotification.answer = "denied";
  const { pane } = await openTask();
  await userEvent.click(
    within(pane).getByRole("button", { name: "Remind me" }),
  );
  await userEvent.click(
    await screen.findByRole("menuitem", { name: /^Tomorrow/ }),
  );
  expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
  expect(
    await within(pane).findByText(/Notifications are blocked/),
  ).toBeVisible();
});

test("when it's time, a notification shows and a click opens the task", async () => {
  FakeNotification.permission = "granted";
  const { actions, task, at } = await openTask();
  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  act(() => {
    actions.updateTask(task()?.id ?? "", { reminderAt: Date.now() + 100 });
  });
  await waitFor(() => expect(FakeNotification.shown).toHaveLength(1));
  const [shown] = FakeNotification.shown;
  expect(shown?.title).toBe("Call the dentist");
  expect(shown?.options.body).toBe("Tasks");

  act(() => shown?.onclick?.());
  expect(at()).toBe(`/lists/inbox/tasks/${task()?.id}`);
});

test("without permission it shows in the app instead", async () => {
  FakeNotification.permission = "denied";
  const { actions, task, at } = await openTask();
  act(() => {
    actions.updateTask(task()?.id ?? "", { reminderAt: Date.now() + 100 });
  });
  const card = await screen.findByRole("alert");
  expect(card).toHaveTextContent("Call the dentist");
  expect(FakeNotification.shown).toHaveLength(0);

  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  await userEvent.click(within(card).getByRole("button", { name: "Open" }));
  expect(at()).toBe(`/lists/inbox/tasks/${task()?.id}`);
  expect(screen.queryByRole("alert")).toBeNull();
});
