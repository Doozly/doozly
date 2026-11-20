import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DesktopSection } from "./DesktopSection.tsx";

const invoke = vi.hoisted(() =>
  vi.fn(async (cmd: string, _args?: Record<string, unknown>) =>
    cmd === "desktop_settings"
      ? { closeToTray: true, openAtLogin: false, quickAdd: true, hasTray: true }
      : undefined,
  ),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

beforeEach(() => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  invoke.mockClear();
});

test("shows this computer's desktop settings and changes them", async () => {
  render(<DesktopSection />);
  const tray = await screen.findByRole("switch", {
    name: "Keep running in the tray when closed",
  });
  const login = screen.getByRole("switch", {
    name: "Open Doozly when you log in",
  });
  expect(tray).toBeChecked();
  expect(login).not.toBeChecked();
  const quick = screen.getByRole("switch", {
    name: "Add a task from anywhere with Ctrl+Alt+N",
  });
  expect(quick).toBeChecked();
  await userEvent.click(quick);
  expect(invoke).toHaveBeenCalledWith("set_quick_add", { on: false });

  await userEvent.click(login);
  expect(invoke).toHaveBeenCalledWith("set_open_at_login", { on: true });
  expect(login).toBeChecked();
});

test("a change the system refuses flips back", async () => {
  invoke.mockImplementationOnce(async () => ({
    closeToTray: true,
    openAtLogin: false,
    quickAdd: true,
    hasTray: true,
  }));
  invoke.mockImplementationOnce(async () => {
    throw new Error("no autostart here");
  });
  render(<DesktopSection />);
  const login = await screen.findByRole("switch", {
    name: "Open Doozly when you log in",
  });
  await userEvent.click(login);
  await waitFor(() => expect(login).not.toBeChecked());
});

test("without a tray it says closing minimises", async () => {
  invoke.mockImplementationOnce(async () => ({
    closeToTray: true,
    openAtLogin: false,
    quickAdd: true,
    hasTray: false,
  }));
  render(<DesktopSection />);
  expect(await screen.findByText(/closing Doozly minimises it/)).toBeVisible();
});

test("the web app has no desktop section", () => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  const { container } = render(<DesktopSection />);
  expect(container).toBeEmptyDOMElement();
  expect(invoke).not.toHaveBeenCalled();
});
