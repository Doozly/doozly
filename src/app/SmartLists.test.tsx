import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { INBOX_ID } from "../data/model.ts";
import type { Actions } from "../state/actions.ts";
import { renderApp } from "../test/render.tsx";
import { useUi } from "./uiStore.ts";

beforeEach(() => {
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    completedFolded: {},
    renamingListId: null,
  });
});

function seed(a: Actions) {
  const shop = a.addList("Groceries");
  const milk = a.addTask(shop.id, "Milk");
  a.addTask(shop.id, "Bread");
  const rent = a.addTask(INBOX_ID, "Pay rent");
  const done = a.addTask(INBOX_ID, "Old thing");
  if (milk) a.toggleImportant(milk.id);
  if (rent) a.toggleImportant(rent.id);
  if (done) {
    a.toggleImportant(done.id);
    a.toggleCompleted(done.id);
  }
}

const sidebar = () => screen.getByRole("navigation", { name: "Lists" });
const titles = (list: HTMLElement) =>
  within(list)
    .getAllByRole("link")
    .map((a) => a.textContent);

test("Important gathers open starred tasks from every list, saying where each lives", async () => {
  await renderApp("/lists/important", seed);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Important",
  );
  const list = screen.getByRole("list", { name: "Tasks" });
  expect(titles(list).sort()).toEqual(["Milk", "Pay rent"]);
  const milkRow = within(list)
    .getByRole("link", { name: "Milk" })
    .closest("li");
  expect(milkRow).toHaveTextContent("Groceries");
  expect(screen.queryByRole("button", { name: /Completed/ })).toBeNull();
});

test("a task typed into Important is starred and lands in Tasks", async () => {
  const { state } = await renderApp("/lists/important");
  await userEvent.type(
    screen.getByRole("textbox", { name: "Add a task" }),
    "Renew passport{Enter}",
  );
  const made = Object.values(state().tasks).find(
    (t) => t.title === "Renew passport",
  );
  expect(made).toMatchObject({ important: true, listId: INBOX_ID });
  expect(screen.getByRole("link", { name: "Renew passport" })).toBeVisible();
});

test("unstarring drops it out of Important", async () => {
  await renderApp("/lists/important", seed);
  await userEvent.click(
    screen.getByRole("button", { name: "Important: Milk" }),
  );
  expect(screen.queryByRole("link", { name: "Milk" })).toBeNull();
});

test("All shows every open task, grouped under its list with Tasks first", async () => {
  await renderApp("/lists/all", seed);
  const groups = screen.getAllByRole("heading", { level: 2 });
  expect(groups.map((h) => h.textContent)).toEqual(["Tasks", "Groceries"]);
  expect(titles(screen.getByRole("list", { name: "Tasks" }))).toEqual([
    "Pay rent",
  ]);
  expect(
    titles(screen.getByRole("list", { name: "Groceries" })).sort(),
  ).toEqual(["Bread", "Milk"]);
});

test("a task opened from a smart list keeps the smart list around it", async () => {
  const { at } = await renderApp("/lists/important", seed);
  await userEvent.click(screen.getByRole("link", { name: "Milk" }));
  expect(at()).toMatch(/^\/lists\/important\/tasks\//);
  expect(
    screen.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Important",
  );
});

test("the sidebar counts open tasks in the smart lists", async () => {
  await renderApp("/lists/inbox", seed);
  expect(
    within(sidebar()).getByRole("link", { name: "Important 2 open tasks" }),
  ).toBeVisible();
  expect(
    within(sidebar()).getByRole("link", { name: "All 3 open tasks" }),
  ).toBeVisible();
});

test("smart lists can't be renamed and have no list menu", async () => {
  await renderApp("/lists/all");
  expect(
    within(screen.getByRole("heading", { level: 1 })).queryByRole("button"),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "List options" })).toBeNull();
});
