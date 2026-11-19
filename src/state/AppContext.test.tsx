import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { INBOX_ID } from "../data/model.ts";
import { testApp } from "../test/app.ts";
import { AppProvider, useActions, useAppState } from "./AppContext.tsx";

function Counter() {
  const count = useAppState((s) => Object.keys(s.tasks).length);
  const { addTask } = useActions();
  return (
    <button type="button" onClick={() => addTask(INBOX_ID, "Milk")}>
      {count} tasks
    </button>
  );
}

test("components re-render right away when an action runs", async () => {
  const { app, actions } = await testApp();
  render(
    <AppProvider value={{ app, actions }}>
      <Counter />
    </AppProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "0 tasks" }));
  expect(screen.getByRole("button", { name: "1 tasks" })).toBeInTheDocument();
});

test("hooks without a provider say what's missing", () => {
  expect(() => render(<Counter />)).toThrow(/AppProvider/);
});
