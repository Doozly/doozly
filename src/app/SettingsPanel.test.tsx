import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { App } from "../App.tsx";
import { AppProvider } from "../state/AppContext.tsx";
import { setting } from "../state/actions.ts";
import { testApp } from "../test/app.ts";
import { AccountButton } from "./Shell.tsx";
import { applyTheme, THEME_KEY } from "./theme.ts";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  document.head.innerHTML = "";
});

async function renderApp() {
  // Like the idle preload in the real app, so it isn't still loading mid-test
  await AccountButton.preload();
  const t = await testApp();
  render(
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <Router hook={memoryLocation({ path: "/lists/inbox" }).hook}>
        <App />
      </Router>
    </AppProvider>,
  );
  return t;
}

test("applyTheme sets the override, remembers it, and clears it for system", () => {
  document.head.innerHTML = `
    <meta name="theme-color" content="" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="" media="(prefers-color-scheme: dark)">`;
  const metas = () =>
    [...document.querySelectorAll<HTMLMetaElement>("meta")].map(
      (m) => m.content,
    );

  applyTheme("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  expect(metas()).toEqual(["#232326", "#232326"]);

  applyTheme("system");
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(localStorage.getItem(THEME_KEY)).toBe("system");
  expect(metas()).toEqual(["#0a7570", "#232326"]);
});

test("picking a theme in Settings switches the page and saves it", async () => {
  const { state } = await renderApp();
  expect(document.documentElement.dataset.theme).toBeUndefined();

  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  expect(dialog).toBeVisible();
  expect(
    screen.getByRole("radio", { name: "Use system setting" }),
  ).toBeChecked();

  await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
  expect(setting(state(), "theme")).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("the general switches flip their setting", async () => {
  const { state } = await renderApp();
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  const sw = await screen.findByRole("switch", {
    name: "Add new tasks on top",
  });
  expect(sw).toBeChecked();
  await userEvent.click(sw);
  expect(setting(state(), "addNewTasksOnTop")).toBe(false);
  expect(sw).not.toBeChecked();
});

test("closing Settings takes it away again", async () => {
  await renderApp();
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog", { name: "Settings" });
  await userEvent.click(screen.getByRole("button", { name: "Close settings" }));
  expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
});
