import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

beforeEach(() => {
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    completedFolded: {},
    renamingListId: null,
    groupsFolded: {},
    renamingGroupId: null,
    search: "",
  });
});

const box = () => screen.getByRole("searchbox", { name: "Search" });
const heading = () => screen.getByRole("heading", { level: 1 });

async function seeded() {
  return renderApp("/lists/inbox", (a) => {
    const shop = a.addList("Shopping");
    a.addTask(shop.id, "Oat milk");
    a.addTask(INBOX_ID, "Call the dairy", { note: "ask about milk delivery" });
    const trip = a.addTask(INBOX_ID, "Trip");
    if (trip) a.addStep(trip.id, "Buy milk for the road");
    a.addTask(INBOX_ID, "Laundry");
    const done = a.addTask(INBOX_ID, "Old milk run");
    if (done) a.toggleCompleted(done.id);
  });
}

test("typing searches titles, notes and steps, grouped by list", async () => {
  const { at } = await seeded();
  await userEvent.type(box(), "milk");

  expect(at()).toBe("/lists/search");
  expect(heading()).toHaveTextContent('Searching for "milk"');
  expect(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
  ).toEqual(["Tasks", "Shopping"]);
  const titles = (name: string) =>
    within(screen.getByRole("list", { name }))
      .getAllByRole("link")
      .map((l) => l.textContent);
  expect(titles("Tasks").sort()).toEqual(["Call the dairy", "Trip"]);
  expect(titles("Shopping")).toEqual(["Oat milk"]);
  expect(titles("Completed tasks")).toEqual(["Old milk run"]);
  // Search has nowhere to add a task to
  expect(screen.queryByRole("textbox", { name: "Add a task" })).toBeNull();
});

test("a result opens in the detail pane, and the search stays", async () => {
  const { at } = await seeded();
  await userEvent.type(box(), "oat");
  await userEvent.click(screen.getByRole("link", { name: "Oat milk" }));
  expect(at()).toMatch(/^\/lists\/search\/tasks\//);
  expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Oat milk",
  );
  expect(box()).toHaveValue("oat");
});

test("no match says so, Escape goes back to the list you were on", async () => {
  const { at } = await seeded();
  await userEvent.type(box(), "zebra");
  expect(screen.getByText(/Nothing matches "zebra"/)).toBeVisible();

  await userEvent.keyboard("{Escape}");
  expect(at()).toBe("/lists/inbox");
  expect(box()).toHaveValue("");
});

test("picking a list in the sidebar ends the search", async () => {
  await seeded();
  await userEvent.type(box(), "milk");
  await userEvent.click(screen.getByRole("link", { name: /^Shopping/ }));
  expect(heading()).toHaveTextContent("Shopping");
  expect(box()).toHaveValue("");
});
