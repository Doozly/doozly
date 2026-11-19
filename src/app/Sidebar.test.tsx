import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { INBOX_ID } from "../data/model.ts";
import { renderApp } from "../test/render.tsx";
import { setViewportWidth } from "../test/setup.ts";
import { useUi } from "./uiStore.ts";

beforeEach(() => {
  useUi.setState({ sidebarCollapsed: false, drawerOpen: false });
});

const sidebar = () => screen.getByRole("navigation", { name: "Lists" });
const linkNames = () =>
  within(sidebar())
    .getAllByRole("link")
    .map((a) => a.textContent?.trim());

test("Tasks comes first, then the user's lists in order", async () => {
  await renderApp("/", (a) => {
    a.addList("Groceries");
    a.addList("Holiday");
  });
  expect(linkNames()).toEqual(["Tasks", "Groceries", "Holiday"]);
});

test("each list shows how many tasks are still open", async () => {
  await renderApp("/", (a) => {
    const list = a.addList("Groceries");
    a.addTask(list.id, "Milk");
    const done = a.addTask(list.id, "Bread");
    const gone = a.addTask(list.id, "Eggs");
    if (done) a.toggleCompleted(done.id);
    if (gone) a.deleteTask(gone.id);
    a.addTask(INBOX_ID, "Call mum");
  });
  expect(
    within(sidebar()).getByRole("link", { name: "Groceries 1 open task" }),
  ).toBeVisible();
  expect(
    within(sidebar()).getByRole("link", { name: "Tasks 1 open task" }),
  ).toBeVisible();
});

test("lists without open tasks show no number", async () => {
  await renderApp("/", (a) => a.addList("Empty"));
  expect(within(sidebar()).getByRole("link", { name: "Empty" })).toBeVisible();
});

test("typing a name and Enter makes the list and opens it", async () => {
  const { at, state } = await renderApp();
  const input = screen.getByRole("textbox", { name: "New list" });
  await userEvent.type(input, "Trip to Lisbon{Enter}");

  expect(
    screen.getByRole("heading", { level: 1, name: "Trip to Lisbon" }),
  ).toBeVisible();
  expect(input).toHaveValue("");
  const made = Object.values(state().lists).find(
    (l) => l.title === "Trip to Lisbon",
  );
  expect(at()).toBe(`/lists/${made?.id}`);
});

test("Enter without a name makes Untitled list, then Untitled list (1)", async () => {
  await renderApp();
  const input = screen.getByRole("textbox", { name: "New list" });
  await userEvent.type(input, "{Enter}");
  await userEvent.type(input, "{Enter}");
  expect(linkNames()).toEqual(["Tasks", "Untitled list", "Untitled list (1)"]);
});

test("Escape throws the typed name away", async () => {
  await renderApp();
  const input = screen.getByRole("textbox", { name: "New list" });
  await userEvent.type(input, "Nope{Escape}");
  expect(input).toHaveValue("");
  expect(linkNames()).toEqual(["Tasks"]);
});

test("in the drawer, making a list closes it", async () => {
  setViewportWidth(400);
  await renderApp();
  await userEvent.click(screen.getByRole("button", { name: "Show lists" }));
  const drawer = await screen.findByRole("dialog", { name: "Lists" });
  await userEvent.type(
    within(drawer).getByRole("textbox", { name: "New list" }),
    "Errands{Enter}",
  );
  expect(useUi.getState().drawerOpen).toBe(false);
  expect(
    screen.getByRole("heading", { level: 1, name: "Errands" }),
  ).toBeVisible();
});
