import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { INBOX_ID } from "../data/model.ts";
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

/** One task in Tasks, opened in the detail pane */
async function openTask(title = "Buy milk") {
  const app = await renderApp("/lists/inbox", (a) =>
    a.addTask(INBOX_ID, title),
  );
  const id = Object.values(app.state().tasks)[0]?.id ?? "";
  await userEvent.click(screen.getByRole("link", { name: title }));
  const pane = screen.getByRole("complementary", { name: "Task details" });
  const titleBox = within(pane).getByRole("textbox", { name: "Task title" });
  return { ...app, id, pane, titleBox };
}

test("the title saves on its own shortly after typing stops", async () => {
  const { titleBox, state, id } = await openTask();
  await userEvent.type(titleBox, " and eggs");
  expect(state().tasks[id]?.title).toBe("Buy milk");
  await waitFor(() =>
    expect(state().tasks[id]?.title).toBe("Buy milk and eggs"),
  );
  // The row follows
  expect(screen.getByRole("link", { name: "Buy milk and eggs" })).toBeVisible();
});

test("leaving the field saves straight away", async () => {
  const { titleBox, state, id } = await openTask();
  await userEvent.type(titleBox, "!");
  await userEvent.tab();
  expect(state().tasks[id]?.title).toBe("Buy milk!");
});

test("closing the pane doesn't lose an edit still waiting", async () => {
  const { titleBox, state, id } = await openTask();
  await userEvent.type(titleBox, "!");
  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  expect(state().tasks[id]?.title).toBe("Buy milk!");
});

test("an emptied title goes back to the old one", async () => {
  const { titleBox, state, id } = await openTask();
  await userEvent.clear(titleBox);
  await userEvent.tab();
  expect(titleBox).toHaveValue("Buy milk");
  expect(state().tasks[id]?.title).toBe("Buy milk");
});

test("Enter finishes editing and never adds a line break", async () => {
  const { titleBox, state, id } = await openTask();
  await userEvent.type(titleBox, "{Enter}");
  expect(titleBox).not.toHaveFocus();
  await userEvent.click(titleBox);
  await userEvent.paste("\nsemi-skimmed");
  await userEvent.tab();
  expect(state().tasks[id]?.title).toBe("Buy milk semi-skimmed");
});

test("ticking it off in the pane completes the task", async () => {
  const { pane, state, id } = await openTask();
  await userEvent.click(
    within(pane).getByRole("checkbox", { name: "Buy milk" }),
  );
  expect(state().tasks[id]?.completedAt).not.toBeNull();
  expect(
    within(screen.getByRole("list", { name: "Completed tasks" })).getByRole(
      "checkbox",
      { name: "Buy milk" },
    ),
  ).toBeChecked();
});

test("the footer says when it was made, and delete removes it", async () => {
  const { pane, state, id } = await openTask();
  expect(within(pane).getByText("Created today")).toBeVisible();
  await userEvent.click(
    within(pane).getByRole("button", { name: "Delete task" }),
  );
  const dialog = await screen.findByRole("alertdialog");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Delete task" }),
  );
  expect(state().tasks[id]?.deletedAt).not.toBeNull();
  await waitFor(() =>
    expect(
      screen.queryByRole("complementary", { name: "Task details" }),
    ).toBeNull(),
  );
});

test("a change from elsewhere shows up while not typing", async () => {
  const { titleBox, actions, id } = await openTask();
  act(() => {
    actions.updateTask(id, { title: "Buy oat milk" });
  });
  expect(titleBox).toHaveValue("Buy oat milk");
});
