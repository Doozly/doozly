import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { App } from "../../state/store.ts";
import { createSyncEngine } from "../../sync/engine.ts";
import { createMemoryProvider } from "../../sync/memoryProvider.ts";
import { AuthError } from "../../sync/provider.ts";
import { type AccountAuth, createSession } from "../../sync/session.ts";
import { renderApp } from "../../test/render.tsx";

afterEach(() => localStorage.clear());

function fakeAuth() {
  let signedIn = false;
  return {
    signIn: vi.fn(async () => {
      signedIn = true;
      return { id: "1", email: "sam@example.com", name: "Sam Taylor" };
    }),
    token: async () => {
      if (!signedIn) throw new AuthError();
      return "t";
    },
    signOut: vi.fn(async () => {
      signedIn = false;
    }),
  } satisfies AccountAuth;
}

const withSession = (auth: AccountAuth) => (app: App) =>
  createSession({
    app,
    auths: { microsoft: auth },
    storage: localStorage,
    locks: null,
    makeProvider: () => createMemoryProvider().provider,
    makeEngine: (a, provider) =>
      createSyncEngine({ app: a, provider, debounceMs: 0 }),
  });

const landing = () =>
  screen.queryByRole("heading", { level: 1, name: "Your tasks, kept simple." });

test("a first visit gets the landing page, Get started goes to My Day for good", async () => {
  const { at } = await renderApp("/");
  expect(landing()).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Get started" }));
  await waitFor(() => expect(at()).toBe("/lists/my-day"));
  expect(landing()).not.toBeInTheDocument();
  expect(localStorage.getItem("doozly:welcomed")).toBe("1");
});

test("the footer links to the desktop app and how to install it", async () => {
  await renderApp("/");
  expect(
    await screen.findByRole("link", { name: "Desktop app" }),
  ).toHaveAttribute("href", "https://github.com/Doozly/doozly#desktop-app");
});

test("someone who got started before goes straight in", async () => {
  localStorage.setItem("doozly:welcomed", "1");
  const { at } = await renderApp("/");
  await waitFor(() => expect(at()).toBe("/lists/my-day"));
  expect(landing()).not.toBeInTheDocument();
});

test("tasks from before the landing page existed skip it too", async () => {
  const { at } = await renderApp("/", (a) => {
    a.addTask("inbox", "Buy milk");
  });
  await waitFor(() => expect(at()).toBe("/lists/my-day"));
  expect(landing()).not.toBeInTheDocument();
});

test("a deep link never shows it", async () => {
  await renderApp("/lists/inbox");
  expect(landing()).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeInTheDocument();
});

test("without any providers set up it only offers Get started", async () => {
  await renderApp("/");
  expect(landing()).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Sign in with/ }),
  ).not.toBeInTheDocument();
});

test("signing in with a provider goes into the app, signed in", async () => {
  const auth = fakeAuth();
  const { at, session } = await renderApp("/", undefined, withSession(auth));
  await session?.start();

  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in with Microsoft" }),
  );
  expect(auth.signIn).toHaveBeenCalled();
  await waitFor(() => expect(at()).toBe("/lists/my-day"));
  expect(localStorage.getItem("doozly:welcomed")).toBe("1");
  expect(
    await screen.findByRole("button", { name: /signed in as Sam Taylor/ }),
  ).toBeInTheDocument();
});
