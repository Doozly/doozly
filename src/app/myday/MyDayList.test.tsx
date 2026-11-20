import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

beforeEach(() => {
  // Thursday 19 November 2026, late evening
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 19, 23, 50));
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

const openTitles = () =>
  within(screen.getByRole("list", { name: "Tasks" }))
    .getAllByRole("link")
    .map((l) => l.textContent);

test("My Day shows today's tasks, with the date under the title", async () => {
  await renderApp("/lists/my-day", (a) => {
    a.addTask(INBOX_ID, "Today's", { myDay: "2026-11-19" });
    a.addTask(INBOX_ID, "Yesterday's", { myDay: "2026-11-18" });
    a.addTask(INBOX_ID, "Never");
  });
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My Day");
  expect(screen.getByText("Thursday 19 November")).toBeVisible();
  expect(openTitles()).toEqual(["Today's"]);
});

test("a task typed into My Day is in today's My Day and lands in Tasks", async () => {
  const { state } = await renderApp("/lists/my-day");
  await userEvent.type(
    screen.getByRole("textbox", { name: "Add a task" }),
    "Call mum{Enter}",
  );
  expect(Object.values(state().tasks)[0]).toMatchObject({
    myDay: "2026-11-19",
    listId: INBOX_ID,
  });
  expect(openTitles()).toEqual(["Call mum"]);
});

test("after midnight My Day is empty again, also when the app was left open", async () => {
  await renderApp("/lists/my-day", (a) =>
    a.addTask(INBOX_ID, "Call mum", { myDay: "2026-11-19" }),
  );
  expect(openTitles()).toEqual(["Call mum"]);

  // The tab comes back to the front the next morning
  vi.setSystemTime(new Date(2026, 10, 20, 8));
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(screen.queryByRole("list", { name: "Tasks" })).toBeNull();
  expect(screen.getByText("Friday 20 November")).toBeVisible();
});

test("Suggestions offers yesterday's and due tasks, one tap adds them", async () => {
  const { state } = await renderApp("/lists/my-day", (a) => {
    a.addTask(INBOX_ID, "Left over", { myDay: "2026-11-18" });
    a.addTask(INBOX_ID, "Pay rent", { dueDate: "2026-11-17" });
    a.addTask(INBOX_ID, "Not suggested");
  });
  await userEvent.click(screen.getByRole("button", { name: "Suggestions" }));
  const panel = await screen.findByRole("dialog", { name: "Suggestions" });
  expect(
    within(panel)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent),
  ).toEqual(["Yesterday", "Overdue"]);
  expect(within(panel).queryByText("Not suggested")).toBeNull();

  await userEvent.click(
    within(panel).getByRole("button", { name: "Add Pay rent to My Day" }),
  );
  expect(
    Object.values(state().tasks).find((t) => t.title === "Pay rent")?.myDay,
  ).toBe("2026-11-19");
  expect(within(panel).queryByText("Pay rent")).toBeNull();
});

test("My Day comes first in the sidebar, with its count", async () => {
  await renderApp("/lists/inbox", (a) =>
    a.addTask(INBOX_ID, "Call mum", { myDay: "2026-11-19" }),
  );
  const first = within(screen.getByRole("navigation", { name: "Lists" }))
    .getAllByRole("link")
    .at(0);
  expect(first).toHaveAccessibleName("My Day 1 open task");
});
