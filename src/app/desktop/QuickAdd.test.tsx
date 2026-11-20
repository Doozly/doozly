import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import { AppProvider } from "../../state/AppContext.tsx";
import { testApp } from "../../test/app.ts";
import { QuickAdd } from "./QuickAdd.tsx";

async function show() {
  const t = await testApp();
  const onClose = vi.fn();
  render(
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <QuickAdd onClose={onClose} />
    </AppProvider>,
  );
  return { ...t, onClose };
}

test("Enter adds the task to Tasks and puts the box away", async () => {
  const { state, onClose } = await show();
  const input = screen.getByRole("textbox", { name: "Add a task" });
  expect(input).toHaveFocus();
  expect(screen.getByText("Tasks")).toBeVisible();
  await userEvent.type(input, "Book the dentist{Enter}");
  const tasks = Object.values(state().tasks);
  expect(tasks.map((t) => [t.title, t.listId])).toEqual([
    ["Book the dentist", INBOX_ID],
  ]);
  expect(input).toHaveValue("");
  expect(onClose).toHaveBeenCalledOnce();
});

test("Escape throws the text away, and an empty box adds nothing", async () => {
  const { state, onClose } = await show();
  const input = screen.getByRole("textbox", { name: "Add a task" });
  await userEvent.type(input, "   {Enter}");
  expect(onClose).not.toHaveBeenCalled();
  await userEvent.type(input, "Never mind{Escape}");
  expect(input).toHaveValue("");
  expect(onClose).toHaveBeenCalledOnce();
  expect(Object.values(state().tasks)).toEqual([]);
});
