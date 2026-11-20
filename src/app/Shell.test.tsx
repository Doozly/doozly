import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { INBOX_ID } from "../data/model.ts";
import { AppProvider } from "../state/AppContext.tsx";
import { testApp } from "../test/app.ts";
import { setViewportWidth } from "../test/setup.ts";
import { DetailPane, Shell } from "./Shell.tsx";
import { useUi } from "./uiStore.ts";

beforeEach(() => {
  useUi.setState({ sidebarCollapsed: false, drawerOpen: false });
});

async function renderAt(path: string) {
  await DetailPane.preload();
  const t = await testApp();
  const location = memoryLocation({ path, record: true });
  render(
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <Router hook={location.hook}>
        <Shell />
      </Router>
    </AppProvider>,
  );
  const at = () => location.history.at(-1);
  return { ...t, at };
}

test("the start page goes to the Tasks list", async () => {
  const { at } = await renderAt("/");
  expect(
    screen.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
  expect(at()).toBe(`/lists/${INBOX_ID}`);
});

test("an unknown list falls back to Tasks", async () => {
  const { at } = await renderAt("/lists/not-there");
  expect(at()).toBe(`/lists/${INBOX_ID}`);
});

test("picking a list in the sidebar opens it", async () => {
  const t = await testApp();
  const list = t.actions.addList("Groceries", { accent: "green" });
  const location = memoryLocation({ path: "/", record: true });
  render(
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <Router hook={location.hook}>
        <Shell />
      </Router>
    </AppProvider>,
  );
  const nav = screen.getByRole("navigation", { name: "Lists" });
  await userEvent.click(within(nav).getByRole("link", { name: "Groceries" }));
  expect(
    screen.getByRole("heading", { level: 1, name: "Groceries" }),
  ).toBeVisible();
  expect(within(nav).getByRole("link", { name: "Groceries" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(location.history.at(-1)).toBe(`/lists/${list.id}`);
});

test("a task link opens the details, and close goes back to the list", async () => {
  const t = await testApp();
  const task = t.actions.addTask(INBOX_ID, "Buy milk");
  if (!task) throw new Error("no task");
  const location = memoryLocation({
    path: `/lists/${INBOX_ID}/tasks/${task.id}`,
    record: true,
  });
  render(
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <Router hook={location.hook}>
        <Shell />
      </Router>
    </AppProvider>,
  );
  const details = screen.getByRole("complementary", { name: "Task details" });
  expect(within(details).getByText("Buy milk")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(location.history.at(-1)).toBe(`/lists/${INBOX_ID}`);
});

test("Escape closes the details", async () => {
  const t = await testApp();
  const task = t.actions.addTask(INBOX_ID, "Buy milk");
  if (!task) throw new Error("no task");
  const location = memoryLocation({
    path: `/lists/${INBOX_ID}/tasks/${task.id}`,
  });
  render(
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <Router hook={location.hook}>
        <Shell />
      </Router>
    </AppProvider>,
  );
  screen.getByRole("button", { name: "Close details" }).focus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("complementary")).toBeNull();
});

test("a task that lives in another list closes the details", async () => {
  const t = await testApp();
  const other = t.actions.addList("Other");
  const task = t.actions.addTask(other.id, "Elsewhere");
  if (!task) throw new Error("no task");
  const location = memoryLocation({
    path: `/lists/${INBOX_ID}/tasks/${task.id}`,
    record: true,
  });
  render(
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <Router hook={location.hook}>
        <Shell />
      </Router>
    </AppProvider>,
  );
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(location.history.at(-1)).toBe(`/lists/${INBOX_ID}`);
});

test("on wide screens the sidebar can be hidden and shown again", async () => {
  await renderAt("/");
  await userEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
  expect(screen.queryByRole("navigation", { name: "Lists" })).toBeNull();
  expect(useUi.getState().sidebarCollapsed).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "Show lists" }));
  expect(screen.getByRole("navigation", { name: "Lists" })).toBeVisible();
});

test("on narrow screens the lists open in a drawer that closes after picking", async () => {
  setViewportWidth(400);
  const { at } = await renderAt("/");
  expect(screen.queryByRole("navigation", { name: "Lists" })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Show lists" }));
  const drawer = await screen.findByRole("dialog", { name: "Lists" });
  await userEvent.click(within(drawer).getByRole("link", { name: "Tasks" }));
  expect(useUi.getState().drawerOpen).toBe(false);
  expect(at()).toBe(`/lists/${INBOX_ID}`);
});
