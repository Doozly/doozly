import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import { renderApp } from "../../test/render.tsx";
import { updates, watchDesktopUpdates } from "../pwa/serviceWorker.ts";
import { UpdateNotice } from "../pwa/UpdateNotice.tsx";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => {}),
  handlers: {} as Record<string, (e: { payload: unknown }) => void>,
}));

// The real Tauri API talks to the Rust side, here it's a fake one
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: (e: { payload: unknown }) => void) => {
    tauri.handlers[event] = handler;
    return () => {
      delete tauri.handlers[event];
    };
  },
}));

beforeEach(() => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  tauri.invoke.mockClear();
  updates.setState({ waiting: null, desktop: null });
});

test("in the desktop app the Rust side gets the reminders, and a click opens the task", async () => {
  const later = Date.now() + 60 * 60 * 1000;
  const { state, at } = await renderApp("/lists/inbox", (a) => {
    a.addTask(INBOX_ID, "Call the dentist", { reminderAt: later });
  });
  const task = Object.values(state().tasks)[0];
  await waitFor(() =>
    expect(tauri.invoke).toHaveBeenCalledWith("set_reminders", {
      reminders: [
        {
          id: `${task?.id}@${later}`,
          fireAt: later,
          title: "Call the dentist",
          body: "Tasks",
          path: `/lists/inbox/tasks/${task?.id}`,
        },
      ],
    }),
  );

  await waitFor(() => expect(tauri.handlers["doozly:open"]).toBeDefined());
  act(() =>
    tauri.handlers["doozly:open"]?.({
      payload: `/lists/inbox/tasks/${task?.id}`,
    }),
  );
  expect(at()).toBe(`/lists/inbox/tasks/${task?.id}`);
});

test("the tray's Add a task goes to the add field, like N does", async () => {
  await renderApp("/lists/inbox");
  await waitFor(() => expect(tauri.handlers["doozly:shortcut"]).toBeDefined());
  act(() => tauri.handlers["doozly:shortcut"]?.({ payload: "newTask" }));
  expect(screen.getByRole("textbox", { name: "Add a task" })).toHaveFocus();
  // Anything else is ignored
  act(() => tauri.handlers["doozly:shortcut"]?.({ payload: "rm -rf" }));
});

test("To Do's Ctrl keys work in the desktop app, also while typing", async () => {
  const { state } = await renderApp("/lists/inbox", (a) => {
    a.addTask(INBOX_ID, "Milk");
  });
  screen.getByRole("link", { name: "Milk" }).focus();
  await userEvent.keyboard("{Control>}t{/Control}");
  expect(Object.values(state().tasks)[0]?.myDay).not.toBeNull();

  screen.getByRole("searchbox", { name: "Search" }).focus();
  await userEvent.keyboard("{Control>}n{/Control}");
  expect(screen.getByRole("textbox", { name: "Add a task" })).toHaveFocus();
});

test("in the browser Ctrl keys stay the browser's", async () => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  const { state } = await renderApp("/lists/inbox", (a) => {
    a.addTask(INBOX_ID, "Milk");
  });
  screen.getByRole("link", { name: "Milk" }).focus();
  await userEvent.keyboard("{Control>}t{/Control}");
  expect(Object.values(state().tasks)[0]?.myDay).toBeNull();
});

test("a downloaded update waits for Restart, which installs it", async () => {
  watchDesktopUpdates();
  render(<UpdateNotice />);
  await waitFor(() => expect(tauri.handlers["doozly:update"]).toBeDefined());
  expect(tauri.invoke).toHaveBeenCalledWith("update_ready");
  expect(screen.queryByRole("status")).toBeNull();

  act(() => tauri.handlers["doozly:update"]?.({ payload: "0.2.0" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "A new version of Doozly is ready.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Restart" }));
  expect(tauri.invoke).toHaveBeenCalledWith("install_update");
});

test("an update that was ready before the window listened still shows", async () => {
  tauri.invoke.mockImplementationOnce(async () => "0.2.0" as never);
  watchDesktopUpdates();
  render(<UpdateNotice />);
  expect(await screen.findByRole("button", { name: "Restart" })).toBeVisible();
});
