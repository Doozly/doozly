import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../data/model.ts";
import { renderApp } from "../test/render.tsx";
import { useUi } from "./uiStore.ts";

beforeEach(() => {
  // Thursday 19 November 2026
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

test("Planned groups tasks by when they're due, soonest first", async () => {
  await renderApp("/lists/planned", (a) => {
    const add = (title: string, dueDate: string | null) =>
      a.addTask(INBOX_ID, title, { dueDate });
    add("Library books", "2026-11-12");
    add("Pay rent", "2026-11-19");
    add("Dentist", "2026-11-20");
    add("Party", "2026-11-22");
    add("Car service", "2026-12-03");
    add("Holiday", "2026-11-28");
    add("No date", null);
    const done = add("Done already", "2026-11-19");
    if (done) a.toggleCompleted(done.id);
  });

  const groups = screen.getAllByRole("heading", { level: 2 });
  expect(groups.map((h) => h.textContent)).toEqual([
    "Earlier",
    "Today",
    "Tomorrow",
    "This week",
    "Later",
  ]);
  const titles = (name: string) =>
    within(screen.getByRole("list", { name }))
      .getAllByRole("link")
      .map((l) => l.textContent);
  expect(titles("Earlier")).toEqual(["Library books"]);
  expect(titles("Today")).toEqual(["Pay rent"]);
  expect(titles("Tomorrow")).toEqual(["Dentist"]);
  expect(titles("This week")).toEqual(["Party"]);
  expect(titles("Later")).toEqual(["Holiday", "Car service"]);
  expect(screen.queryByRole("link", { name: "No date" })).toBeNull();
});

test("a task typed into Planned is due today and lands in Tasks", async () => {
  const { state } = await renderApp("/lists/planned");
  await userEvent.type(
    screen.getByRole("textbox", { name: "Add a task" }),
    "Call the bank{Enter}",
  );
  const made = Object.values(state().tasks)[0];
  expect(made).toMatchObject({ dueDate: "2026-11-19", listId: INBOX_ID });
  expect(
    within(screen.getByRole("list", { name: "Today" })).getByRole("link", {
      name: "Call the bank",
    }),
  ).toBeVisible();
});

test("the sidebar counts open tasks with a due date", async () => {
  await renderApp("/", (a) => {
    a.addTask(INBOX_ID, "One", { dueDate: "2026-11-19" });
    a.addTask(INBOX_ID, "Two", { dueDate: "2026-11-30" });
    a.addTask(INBOX_ID, "Three");
  });
  expect(
    within(screen.getByRole("navigation", { name: "Lists" })).getByRole(
      "link",
      { name: "Planned 2 open tasks" },
    ),
  ).toBeVisible();
});
