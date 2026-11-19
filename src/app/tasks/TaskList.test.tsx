import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

const ding = vi.hoisted(() => vi.fn());
vi.mock("../../ui/sound.ts", () => ({ playDing: ding }));

beforeEach(() => {
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    completedFolded: {},
  });
  ding.mockClear();
});

const openTitles = () =>
  within(screen.getByRole("list", { name: "Tasks" }))
    .getAllByRole("checkbox")
    .map((c) => c.getAttribute("aria-label"));

test("Enter adds the task on top and keeps the cursor in the box", async () => {
  await renderApp();
  const input = screen.getByRole("textbox", { name: "Add a task" });
  await userEvent.type(input, "Buy milk{Enter}");
  await userEvent.type(input, "Call mum{Enter}");
  expect(openTitles()).toEqual(["Call mum", "Buy milk"]);
  expect(input).toHaveValue("");
  expect(input).toHaveFocus();
});

test("an empty or blank task is not added", async () => {
  await renderApp();
  const input = screen.getByRole("textbox", { name: "Add a task" });
  await userEvent.type(input, "   {Enter}");
  expect(screen.queryByRole("list", { name: "Tasks" })).toBeNull();
});

test("ticking a task moves it to Completed and plays the chime", async () => {
  await renderApp("/", (a) => {
    a.addTask(INBOX_ID, "Buy milk");
    a.addTask(INBOX_ID, "Call mum");
  });
  await userEvent.click(screen.getByRole("checkbox", { name: "Buy milk" }));

  expect(openTitles()).toEqual(["Call mum"]);
  const completed = screen.getByRole("list", { name: "Completed tasks" });
  expect(
    within(completed).getByRole("checkbox", { name: "Buy milk" }),
  ).toBeChecked();
  expect(screen.getByRole("button", { name: /Completed/ })).toHaveTextContent(
    "Completed1",
  );
  expect(ding).toHaveBeenCalledOnce();
});

test("no chime when that setting is off", async () => {
  await renderApp("/", (a) => {
    a.setSetting("playCompletionSound", false);
    a.addTask(INBOX_ID, "Buy milk");
  });
  await userEvent.click(screen.getByRole("checkbox", { name: "Buy milk" }));
  expect(ding).not.toHaveBeenCalled();
});

test("unticking brings it back", async () => {
  await renderApp("/", (a) => {
    const t = a.addTask(INBOX_ID, "Buy milk");
    if (t) a.toggleCompleted(t.id);
  });
  await userEvent.click(screen.getByRole("checkbox", { name: "Buy milk" }));
  expect(openTitles()).toEqual(["Buy milk"]);
  expect(screen.queryByRole("list", { name: "Completed tasks" })).toBeNull();
});

test("the Completed section folds away and back", async () => {
  await renderApp("/", (a) => {
    const t = a.addTask(INBOX_ID, "Buy milk");
    if (t) a.toggleCompleted(t.id);
  });
  const toggle = screen.getByRole("button", { name: /Completed/ });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("list", { name: "Completed tasks" })).toBeNull();
  await userEvent.click(toggle);
  expect(screen.getByRole("list", { name: "Completed tasks" })).toBeVisible();
});

test("lists set to hide completed tasks don't show the section", async () => {
  await renderApp("/", (a) => {
    a.updateList(INBOX_ID, { showCompleted: false });
    const t = a.addTask(INBOX_ID, "Buy milk");
    if (t) a.toggleCompleted(t.id);
  });
  expect(screen.queryByRole("button", { name: /Completed/ })).toBeNull();
});

test("clicking a task opens its details", async () => {
  let id = "";
  const { at } = await renderApp("/", (a) => {
    id = a.addTask(INBOX_ID, "Buy milk")?.id ?? "";
  });
  await userEvent.click(screen.getByRole("link", { name: "Buy milk" }));
  expect(at()).toBe(`/lists/${INBOX_ID}/tasks/${id}`);
  expect(
    screen.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
});

test("delete from the context menu asks first, and Cancel keeps it", async () => {
  await renderApp("/", (a) => a.addTask(INBOX_ID, "Buy milk"));
  fireEvent.contextMenu(screen.getByRole("link", { name: "Buy milk" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Delete task" }),
  );
  const dialog = await screen.findByRole("alertdialog", {
    name: 'Delete "Buy milk"?',
  });
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  // The page is hidden from screen readers until the dialog is really gone
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(openTitles()).toEqual(["Buy milk"]);

  fireEvent.contextMenu(screen.getByRole("link", { name: "Buy milk" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Delete task" }),
  );
  await userEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Delete task",
    }),
  );
  expect(screen.queryByRole("list", { name: "Tasks" })).toBeNull();
});

test("with confirming turned off, delete is immediate", async () => {
  await renderApp("/", (a) => {
    a.setSetting("confirmBeforeDelete", false);
    a.addTask(INBOX_ID, "Buy milk");
  });
  fireEvent.contextMenu(screen.getByRole("link", { name: "Buy milk" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Delete task" }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("list", { name: "Tasks" })).toBeNull();
});

test("Shift+F10 opens the menu from the keyboard, and it can complete", async () => {
  await renderApp("/", (a) => a.addTask(INBOX_ID, "Buy milk"));
  screen.getByRole("link", { name: "Buy milk" }).focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Mark as completed" }),
  );
  const completed = await screen.findByRole("list", {
    name: "Completed tasks",
  });
  expect(
    within(completed).getByRole("checkbox", { name: "Buy milk" }),
  ).toBeChecked();
});

test("empty lists say so", async () => {
  await renderApp("/", (a) => a.addList("Trip"));
  expect(screen.getByText(/aren't in any of your lists/)).toBeVisible();
  await userEvent.click(screen.getByRole("link", { name: "Trip" }));
  expect(screen.getByText(/Nothing here yet/)).toBeVisible();
});
