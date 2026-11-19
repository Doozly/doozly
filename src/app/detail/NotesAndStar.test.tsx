import { screen, waitFor, within } from "@testing-library/react";
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
  });
});

const openOrder = () =>
  within(screen.getByRole("list", { name: "Tasks" }))
    .getAllByRole("link")
    .map((a) => a.textContent);

test("the star on a row and in the pane are the same switch", async () => {
  const { state } = await renderApp("/", (a) =>
    a.addTask(INBOX_ID, "Buy milk"),
  );
  const rowStar = screen.getByRole("button", { name: "Important: Buy milk" });
  expect(rowStar).toHaveAttribute("aria-pressed", "false");

  await userEvent.click(rowStar);
  expect(rowStar).toHaveAttribute("aria-pressed", "true");
  expect(Object.values(state().tasks)[0]?.important).toBe(true);

  await userEvent.click(screen.getByRole("link", { name: "Buy milk" }));
  const pane = screen.getByRole("complementary", { name: "Task details" });
  const paneStar = within(pane).getByRole("button", {
    name: "Important: Buy milk",
  });
  expect(paneStar).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(paneStar);
  expect(rowStar).toHaveAttribute("aria-pressed", "false");
});

test("starred tasks move to the top, unless that setting is off", async () => {
  await renderApp("/", (a) => {
    a.setSetting("addNewTasksOnTop", false);
    a.addTask(INBOX_ID, "A");
    a.addTask(INBOX_ID, "B");
    a.addTask(INBOX_ID, "C");
  });
  await userEvent.click(screen.getByRole("button", { name: "Important: C" }));
  expect(openOrder()).toEqual(["C", "A", "B"]);

  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  await userEvent.click(
    await screen.findByRole("switch", { name: "Move starred tasks to top" }),
  );
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(openOrder()).toEqual(["A", "B", "C"]);
});

test("a note saves as you type and the row shows it has one", async () => {
  const { state } = await renderApp("/", (a) =>
    a.addTask(INBOX_ID, "Buy milk"),
  );
  const row = () =>
    screen.getByRole("link", { name: "Buy milk" }).closest("li");
  expect(row()).not.toHaveTextContent("Has a note");

  await userEvent.click(screen.getByRole("link", { name: "Buy milk" }));
  const note = screen.getByRole("textbox", { name: "Note" });
  expect(note).toHaveAttribute("placeholder", "Add note");
  await userEvent.type(note, "The oat one{Enter}Two cartons");
  await waitFor(() =>
    expect(Object.values(state().tasks)[0]?.note).toBe(
      "The oat one\nTwo cartons",
    ),
  );
  expect(row()).toHaveTextContent("Has a note");

  await userEvent.clear(note);
  await userEvent.tab();
  expect(Object.values(state().tasks)[0]?.note).toBe("");
  expect(row()).not.toHaveTextContent("Has a note");
});

test("closing the pane keeps a note still being typed", async () => {
  const { state } = await renderApp("/", (a) =>
    a.addTask(INBOX_ID, "Buy milk"),
  );
  await userEvent.click(screen.getByRole("link", { name: "Buy milk" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Note" }), "Quick");
  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  expect(Object.values(state().tasks)[0]?.note).toBe("Quick");
});
