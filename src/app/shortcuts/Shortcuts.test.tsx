import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import type { Actions } from "../../state/actions.ts";
import { createSession } from "../../sync/session.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

beforeEach(() => {
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    renamingListId: null,
    shortcutsOpen: false,
  });
});

function seed(a: Actions) {
  a.setSetting("addNewTasksOnTop", false);
  for (const title of ["Milk", "Bread", "Eggs"]) a.addTask(INBOX_ID, title);
}

const row = (title: string) => screen.getByRole("link", { name: title });
const task = (t: Awaited<ReturnType<typeof renderApp>>, title: string) =>
  Object.values(t.state().tasks).find(
    (x) => x.title === title && x.deletedAt === null,
  );

test("N goes to Add a task, and there N is just a letter", async () => {
  await renderApp("/lists/inbox", seed);
  await userEvent.keyboard("n");
  const add = screen.getByRole("textbox", { name: "Add a task" });
  expect(add).toHaveFocus();
  await userEvent.keyboard("nap{Enter}");
  expect(row("nap")).toBeVisible();
});

test("D, T and S act on the task with the focus", async () => {
  const t = await renderApp("/lists/inbox", seed);
  row("Bread").focus();
  await userEvent.keyboard("s");
  expect(task(t, "Bread")?.important).toBe(true);
  await userEvent.keyboard("t");
  expect(task(t, "Bread")?.myDay).not.toBeNull();
  await userEvent.keyboard("d");
  expect(task(t, "Bread")?.completedAt).not.toBeNull();
  expect(task(t, "Milk")?.completedAt).toBeNull();
});

test("without a focused row they act on the task open in the details", async () => {
  const t = await renderApp("/lists/inbox", seed);
  const eggs = task(t, "Eggs");
  if (!eggs) throw new Error("no eggs");
  await userEvent.click(row("Eggs"));
  (document.activeElement as HTMLElement).blur();
  await userEvent.keyboard("d");
  expect(task(t, "Eggs")?.completedAt).not.toBeNull();
});

test("Delete asks first, then the focus moves to the next task", async () => {
  const t = await renderApp("/lists/inbox", seed);
  row("Milk").focus();
  await userEvent.keyboard("{Delete}");
  const ask = screen.getByRole("alertdialog");
  await userEvent.click(
    within(ask).getByRole("button", { name: "Delete task" }),
  );
  expect(task(t, "Milk")).toBeUndefined();
  await waitFor(() => expect(row("Bread")).toHaveFocus());
});

test("L makes a new list and puts its name up for editing", async () => {
  const { at } = await renderApp("/lists/inbox", seed);
  await userEvent.keyboard("l");
  const name = screen.getByRole("textbox", { name: "List name" });
  expect(name).toHaveFocus();
  expect(name).toHaveValue("Untitled list");
  expect(at()).toMatch(/^\/lists\/(?!inbox)/);
});

test("F and / go to search", async () => {
  await renderApp("/lists/inbox", seed);
  const search = screen.getByRole("searchbox", { name: "Search" });
  await userEvent.keyboard("f");
  expect(search).toHaveFocus();
  search.blur();
  await userEvent.keyboard("/");
  expect(search).toHaveFocus();
});

test("1 hides and shows the sidebar", async () => {
  await renderApp("/lists/inbox", seed);
  await userEvent.keyboard("1");
  expect(screen.queryByRole("navigation", { name: "Lists" })).toBeNull();
  await userEvent.keyboard("1");
  expect(screen.getByRole("navigation", { name: "Lists" })).toBeVisible();
});

test("R syncs when someone is signed in", async () => {
  const { session } = await renderApp("/lists/inbox", seed, (app) => {
    const s = createSession({ app, auths: {} });
    vi.spyOn(s, "syncNow");
    return s;
  });
  await userEvent.keyboard("r");
  expect(session?.syncNow).toHaveBeenCalledOnce();
});

test("? shows the shortcuts, Escape closes them", async () => {
  await renderApp("/lists/inbox", seed);
  await userEvent.keyboard("?");
  const help = await screen.findByRole("dialog", {
    name: "Keyboard shortcuts",
  });
  expect(within(help).getByText("Complete the selected task")).toBeVisible();
  // Keys pressed in the help don't reach the app behind it
  await userEvent.keyboard("n");
  expect(help).toContainElement(document.activeElement as HTMLElement);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("arrows move between tasks and between lists", async () => {
  const t = await renderApp("/lists/inbox", (a) => {
    seed(a);
    a.addList("Work");
  });
  row("Milk").focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(row("Bread")).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(row("Eggs")).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  expect(row("Eggs")).toHaveFocus();
  await userEvent.keyboard("{Home}{ArrowUp}");
  expect(row("Milk")).toHaveFocus();

  const nav = screen.getByRole("navigation", { name: "Lists" });
  const link = (name: RegExp) => within(nav).getByRole("link", { name });
  link(/^Tasks/).focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(link(/^Work/)).toHaveFocus();
  await userEvent.keyboard("{Home}");
  expect(link(/^My Day/)).toHaveFocus();

  // Alt+arrows still move the task instead of the focus
  row("Milk").focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  const order = within(screen.getByRole("list", { name: "Tasks" }))
    .getAllByRole("link")
    .map((a) => a.textContent);
  expect(order).toEqual(["Bread", "Milk", "Eggs"]);
  expect(task(t, "Milk")).toBeDefined();
});

test("Escape closes the details and goes back to the task's row", async () => {
  const { at } = await renderApp("/lists/inbox", seed);
  await userEvent.click(row("Bread"));
  expect(
    screen.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  expect(at()).toBe(`/lists/${INBOX_ID}`);
  await waitFor(() => expect(row("Bread")).toHaveFocus());

  await userEvent.keyboard("{Enter}");
  expect(at()).toMatch(/\/tasks\//);
  row("Bread").focus();
  await userEvent.keyboard("{Escape}");
  expect(at()).toBe(`/lists/${INBOX_ID}`);
});

test("with the setting off, letters are just letters, Delete still works", async () => {
  const t = await renderApp("/lists/inbox", (a) => {
    seed(a);
    a.setSetting("keyboardShortcuts", false);
    a.setSetting("confirmBeforeDelete", false);
  });
  row("Milk").focus();
  await userEvent.keyboard("dn");
  expect(task(t, "Milk")?.completedAt).toBeNull();
  expect(screen.getByRole("textbox", { name: "Add a task" })).not.toHaveFocus();
  await userEvent.keyboard("{Delete}");
  expect(task(t, "Milk")).toBeUndefined();
});

test("Settings can turn them off and show the list", async () => {
  const t = await renderApp("/lists/inbox", seed);
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  const panel = await screen.findByRole("dialog", { name: "Settings" });
  await userEvent.click(
    within(panel).getByRole("switch", { name: "Single-key shortcuts" }),
  );
  expect(t.state().settings.keyboardShortcuts?.value).toBe(false);
  await userEvent.click(
    within(panel).getByRole("button", { name: "Show keyboard shortcuts" }),
  );
  const help = await screen.findByRole("dialog", {
    name: "Keyboard shortcuts",
  });
  expect(within(help).getByText(/turned off in Settings/)).toBeVisible();
});
