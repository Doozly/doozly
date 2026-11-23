import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

beforeEach(() => {
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    completedFolded: {},
    renamingListId: null,
  });
});

const sidebar = () => screen.getByRole("navigation", { name: "Lists" });
const sidebarLink = (name: string) =>
  within(sidebar()).getByRole("link", { name });
const heading = () => screen.getByRole("heading", { level: 1 });

async function pick(item: string) {
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
}

test("rename from the sidebar menu edits the title in place", async () => {
  await renderApp("/lists/inbox", (a) => a.addList("Groceries"));
  fireEvent.contextMenu(sidebarLink("Groceries"));
  await pick("Rename list");

  const input = await screen.findByRole("textbox", { name: "List name" });
  expect(input).toHaveFocus();
  await userEvent.clear(input);
  await userEvent.type(input, "Food shop{Enter}");

  expect(heading()).toHaveTextContent("Food shop");
  expect(sidebarLink("Food shop")).toBeVisible();
});

test("clicking the title renames, Escape cancels, empty keeps the old name", async () => {
  await renderApp("/lists/inbox", (a) => a.addList("Groceries"));
  await userEvent.click(sidebarLink("Groceries"));

  await userEvent.click(screen.getByRole("button", { name: "Groceries" }));
  let input = screen.getByRole("textbox", { name: "List name" });
  await userEvent.type(input, "Nope{Escape}");
  expect(heading()).toHaveTextContent("Groceries");

  await userEvent.click(screen.getByRole("button", { name: "Groceries" }));
  input = screen.getByRole("textbox", { name: "List name" });
  await userEvent.clear(input);
  await userEvent.type(input, "   {Enter}");
  expect(heading()).toHaveTextContent("Groceries");
});

test("the Tasks list can't be renamed or deleted, only themed, duplicated, printed and sent", async () => {
  await renderApp();
  expect(within(heading()).queryByRole("button", { name: "Tasks" })).toBeNull();
  fireEvent.contextMenu(sidebarLink("Tasks"));
  const items = (await screen.findAllByRole("menuitem")).map(
    (i) => i.textContent,
  );
  expect(items).toEqual([
    "Change theme",
    "Duplicate list",
    "Print list",
    "Email list",
  ]);
});

test("duplicate from the list options opens the copy with its tasks", async () => {
  const { at } = await renderApp("/lists/inbox", (a) => {
    const list = a.addList("Groceries");
    a.addTask(list.id, "Milk");
  });
  await userEvent.click(sidebarLink("Groceries 1 open task"));
  await userEvent.click(screen.getByRole("button", { name: "List options" }));
  await pick("Duplicate list");

  await waitFor(() => expect(heading()).toHaveTextContent("Groceries (1)"));
  expect(screen.getByRole("checkbox", { name: "Milk" })).toBeVisible();
  expect(at()).toMatch(/^\/lists\/[0-9a-f-]{36}$/);
  expect(sidebarLink("Groceries (1) 1 open task")).toBeVisible();
});

test("delete asks first; confirming removes the list and goes home", async () => {
  const { at } = await renderApp("/lists/inbox", (a) => a.addList("Groceries"));
  await userEvent.click(sidebarLink("Groceries"));

  fireEvent.contextMenu(sidebarLink("Groceries"));
  await pick("Delete list");
  let dialog = await screen.findByRole("alertdialog", {
    name: 'Delete "Groceries"?',
  });
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(sidebarLink("Groceries")).toBeVisible();

  fireEvent.contextMenu(sidebarLink("Groceries"));
  await pick("Delete list");
  dialog = await screen.findByRole("alertdialog");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Delete list" }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(
    within(sidebar()).queryByRole("link", { name: "Groceries" }),
  ).toBeNull();
  expect(at()).toBe("/lists/my-day");
});

test("Shift+F10 on a sidebar list opens its menu", async () => {
  await renderApp("/lists/inbox", (a) => a.addList("Groceries"));
  sidebarLink("Groceries").focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  expect(
    await screen.findByRole("menu", { name: "Options for Groceries" }),
  ).toBeVisible();
});

test("Print list prints the list on its own, with its tasks", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  await renderApp("/lists/inbox", (a) => {
    const list = a.addList("Groceries");
    a.addTask(list.id, "Milk");
    const done = a.addTask(list.id, "Eggs");
    if (done) a.toggleCompleted(done.id);
  });
  fireEvent.contextMenu(
    within(sidebar()).getByRole("link", { name: /^Groceries/ }),
  );
  expect(
    await screen.findByRole("menuitem", { name: "Email list" }),
  ).toBeInTheDocument();
  await pick("Print list");

  await waitFor(() => expect(print).toHaveBeenCalledOnce());
  const sheet = document.getElementById("print-root");
  expect(sheet?.querySelector("h1")).toHaveTextContent("Groceries");
  expect(sheet).toHaveTextContent("☐Milk");
  expect(sheet).toHaveTextContent("Completed☑Eggs");
  window.dispatchEvent(new Event("afterprint"));
  expect(document.getElementById("print-root")).toBeNull();
  print.mockRestore();
});
