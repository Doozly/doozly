import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 19, 12));
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    completedFolded: {},
    renamingListId: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const row = () => screen.getByRole("link", { name: "Call mum" }).closest("li");

test("adding from the pane marks the task, and the cross takes it out", async () => {
  const { state } = await renderApp("/lists/inbox", (a) =>
    a.addTask(INBOX_ID, "Call mum"),
  );
  await userEvent.click(screen.getByRole("link", { name: "Call mum" }));
  const pane = screen.getByRole("complementary", { name: "Task details" });

  await userEvent.click(
    within(pane).getByRole("button", { name: "Add to My Day" }),
  );
  expect(Object.values(state().tasks)[0]?.myDay).toBe("2026-11-19");
  expect(
    within(pane).getByRole("button", { name: "Added to My Day" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(row()).toHaveTextContent("My Day");

  await userEvent.click(
    within(pane).getByRole("button", { name: "Remove from My Day" }),
  );
  expect(Object.values(state().tasks)[0]?.myDay).toBeNull();
  expect(row()).not.toHaveTextContent("My Day");
});

test("yesterday's My Day doesn't count today", async () => {
  await renderApp("/lists/inbox", (a) =>
    a.addTask(INBOX_ID, "Call mum", { myDay: "2026-11-18" }),
  );
  expect(row()).not.toHaveTextContent("My Day");
  await userEvent.click(screen.getByRole("link", { name: "Call mum" }));
  expect(screen.getByRole("button", { name: "Add to My Day" })).toBeVisible();
});

test("the row menu adds and removes it too", async () => {
  const { state } = await renderApp("/lists/inbox", (a) =>
    a.addTask(INBOX_ID, "Call mum"),
  );
  fireEvent.contextMenu(screen.getByRole("link", { name: "Call mum" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Add to My Day" }),
  );
  expect(Object.values(state().tasks)[0]?.myDay).toBe("2026-11-19");

  fireEvent.contextMenu(screen.getByRole("link", { name: "Call mum" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Remove from My Day" }),
  );
  expect(Object.values(state().tasks)[0]?.myDay).toBeNull();
});
