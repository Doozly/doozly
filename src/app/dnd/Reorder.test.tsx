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
  });
});

const titles = (name: string) =>
  within(screen.getByRole("list", { name }))
    .getAllByRole("link")
    .map((l) => l.textContent);

const sidebarTitles = () =>
  within(screen.getByRole("navigation", { name: "Lists" }))
    .getAllByRole("link")
    .map((l) => l.querySelector("span")?.textContent);

test("Alt+arrows move a task within its list", async () => {
  const { state } = await renderApp("/lists/inbox", (a) => {
    a.setSetting("addNewTasksOnTop", false);
    for (const t of ["One", "Two", "Three"]) a.addTask(INBOX_ID, t);
  });
  const two = screen.getByRole("link", { name: "Two" });
  expect(two).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
  two.focus();

  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
  expect(titles("Tasks")).toEqual(["Two", "One", "Three"]);
  expect(screen.getByRole("link", { name: "Two" })).toHaveFocus();

  await userEvent.keyboard("{Alt>}{ArrowDown}{ArrowDown}{/Alt}");
  expect(titles("Tasks")).toEqual(["One", "Three", "Two"]);
  expect(Object.values(state().tasks).every((t) => t.listId === INBOX_ID)).toBe(
    true,
  );
});

test("a sorted list or a smart list can't be reordered by hand", async () => {
  await renderApp("/lists/inbox", (a) => {
    a.addTask(INBOX_ID, "One");
    a.addTask(INBOX_ID, "Two");
    a.updateList(INBOX_ID, { sort: { by: "title", direction: "asc" } });
  });
  const one = screen.getByRole("link", { name: "One" });
  expect(one).not.toHaveAttribute("aria-keyshortcuts");
  one.focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  expect(titles("Tasks")).toEqual(["One", "Two"]);
});

test("Alt+arrows move lists and groups in the sidebar", async () => {
  await renderApp("/", (a) => {
    a.addList("A");
    a.addList("B");
    a.addGroup("Home");
  });
  expect(sidebarTitles().slice(5)).toEqual(["A", "B"]);

  screen.getByRole("link", { name: "B" }).focus();
  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
  expect(sidebarTitles().slice(5)).toEqual(["B", "A"]);

  const home = screen.getByRole("button", { name: "Home" });
  home.focus();
  await userEvent.keyboard("{Alt>}{ArrowUp}{ArrowUp}{/Alt}");
  // The group now comes first, its header sits above both lists
  const own = screen.getAllByRole("list")[1];
  expect(own?.firstElementChild).toHaveTextContent("Home");
});

test("Alt+arrows move steps", async () => {
  await renderApp("/", (a) => {
    const t = a.addTask(INBOX_ID, "Trip");
    if (!t) return;
    a.addStep(t.id, "Pack");
    a.addStep(t.id, "Book");
  });
  await userEvent.click(screen.getByRole("link", { name: "Trip" }));
  const book = screen.getByRole("textbox", { name: "Step 2" });
  book.focus();
  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
  expect(screen.getByRole("textbox", { name: "Step 1" })).toHaveValue("Book");
});
