import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import type { Actions } from "../../state/actions.ts";
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

/** "Shop" in Tasks with the given steps, opened in the detail pane */
async function openShop(steps: string[] = []) {
  const app = await renderApp("/", (a: Actions) => {
    const task = a.addTask(INBOX_ID, "Shop");
    for (const s of steps) if (task) a.addStep(task.id, s);
  });
  await userEvent.click(screen.getByRole("link", { name: "Shop" }));
  const pane = screen.getByRole("complementary", { name: "Task details" });
  return { ...app, pane };
}

const stepTitles = (pane: HTMLElement) =>
  within(pane)
    .queryAllByRole("textbox", { name: /^Step \d+$/ })
    .map((i) => (i as HTMLInputElement).value);

const rowMeta = () =>
  screen.getByRole("link", { name: "Shop" }).closest("li")?.textContent;

test("Enter adds a step, keeps the cursor there, and the row counts it", async () => {
  const { pane } = await openShop();
  const add = within(pane).getByRole("textbox", { name: "Add step" });
  expect(add).toHaveAttribute("placeholder", "Add step");
  await userEvent.type(add, "Bread{Enter}");
  await userEvent.type(add, "Butter{Enter}");

  expect(stepTitles(pane)).toEqual(["Bread", "Butter"]);
  expect(add).toHaveValue("");
  expect(add).toHaveFocus();
  expect(add).toHaveAttribute("placeholder", "Next step");
  expect(rowMeta()).toContain("0 of 2");
});

test("ticking a step off counts it as done", async () => {
  const { pane } = await openShop(["Bread", "Butter"]);
  await userEvent.click(within(pane).getByRole("checkbox", { name: "Bread" }));
  expect(within(pane).getByRole("checkbox", { name: "Bread" })).toBeChecked();
  expect(rowMeta()).toContain("1 of 2");
});

test("a step renames in place", async () => {
  const { pane, state } = await openShop(["Bread"]);
  const step = within(pane).getByRole("textbox", { name: "Step 1" });
  await userEvent.clear(step);
  await userEvent.type(step, "Sourdough{Enter}");
  expect(Object.values(state().steps)[0]?.title).toBe("Sourdough");
});

test("Escape throws a step edit away and leaves the pane open", async () => {
  const { pane, state } = await openShop(["Bread"]);
  const step = within(pane).getByRole("textbox", { name: "Step 1" });
  await userEvent.type(step, " rolls{Escape}");
  expect(step).toHaveValue("Bread");
  expect(Object.values(state().steps)[0]?.title).toBe("Bread");
  expect(pane).toBeVisible();
});

test("emptying a step, or its delete button, removes it", async () => {
  const { pane } = await openShop(["Bread", "Butter"]);
  const first = within(pane).getByRole("textbox", { name: "Step 1" });
  await userEvent.clear(first);
  await userEvent.tab();
  expect(stepTitles(pane)).toEqual(["Butter"]);

  await userEvent.click(
    within(pane).getByRole("button", { name: "Delete step Butter" }),
  );
  expect(stepTitles(pane)).toEqual([]);
  expect(rowMeta()).not.toContain(" of ");
});

test("Alt+Up and Alt+Down move a step", async () => {
  const { pane } = await openShop(["A", "B", "C"]);
  within(pane).getByRole("textbox", { name: "Step 3" }).focus();
  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
  expect(stepTitles(pane)).toEqual(["A", "C", "B"]);
  within(pane).getByRole("textbox", { name: "Step 1" }).focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  expect(stepTitles(pane)).toEqual(["C", "A", "B"]);
});
