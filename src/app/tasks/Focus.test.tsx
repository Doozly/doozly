import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import type { Actions } from "../../state/actions.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

beforeEach(() => {
  useUi.setState({ sidebarCollapsed: false, focusDetails: false });
});

function seed(a: Actions) {
  a.setSetting("addNewTasksOnTop", false);
  for (const title of ["Milk", "Bread", "Eggs"]) {
    const t = a.addTask(INBOX_ID, title);
    if (t) a.toggleMyDay(t.id);
  }
}

const completed = () => screen.getByRole("list", { name: "Completed tasks" });

test("ticking with Space keeps the focus on the task, now under Completed", async () => {
  await renderApp("/", seed);
  screen.getByRole("checkbox", { name: "Bread" }).focus();
  await userEvent.keyboard(" ");
  const moved = within(completed()).getByRole("checkbox", { name: "Bread" });
  expect(moved).toBeChecked();
  expect(moved).toHaveFocus();
  // And back again
  await userEvent.keyboard(" ");
  expect(screen.getByRole("checkbox", { name: "Bread" })).toHaveFocus();
});

test("D on a row keeps the focus on that row", async () => {
  await renderApp("/", seed);
  screen.getByRole("link", { name: "Milk" }).focus();
  await userEvent.keyboard("d");
  expect(within(completed()).getByRole("link", { name: "Milk" })).toHaveFocus();
});

test("a row that leaves the list hands the focus to the next one", async () => {
  await renderApp("/lists/my-day", seed);
  screen.getByRole("link", { name: "Milk" }).focus();
  await userEvent.keyboard("t");
  expect(screen.queryByRole("link", { name: "Milk" })).toBeNull();
  expect(screen.getByRole("link", { name: "Bread" })).toHaveFocus();
});

test("Enter opens the details and goes there, Escape comes back", async () => {
  await renderApp("/", seed);
  screen.getByRole("link", { name: "Eggs" }).focus();
  await userEvent.keyboard("{Enter}");
  const pane = screen.getByRole("complementary", { name: "Task details" });
  await waitFor(() => expect(pane).toHaveFocus());
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Eggs" })).toHaveFocus(),
  );
});

test("a click opens the details without taking the focus away", async () => {
  await renderApp("/", seed);
  await userEvent.click(screen.getByRole("link", { name: "Eggs" }));
  expect(
    screen.getByRole("complementary", { name: "Task details" }),
  ).not.toHaveFocus();
});
