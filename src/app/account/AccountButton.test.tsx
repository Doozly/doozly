import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import type { App } from "../../state/store.ts";
import { createSyncEngine } from "../../sync/engine.ts";
import { createMemoryProvider } from "../../sync/memoryProvider.ts";
import { AuthError, SignInError } from "../../sync/provider.ts";
import { type AccountAuth, createSession } from "../../sync/session.ts";
import { renderApp } from "../../test/render.tsx";

afterEach(() => localStorage.clear());

function fakeAuth(id = "1", name = "Sam Taylor", email = "sam@example.com") {
  let signedIn = false;
  return {
    signIn: vi.fn(async () => {
      signedIn = true;
      return { id, email, name };
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

function withSession(auth: AccountAuth) {
  const cloud = createMemoryProvider();
  return (app: App) =>
    createSession({
      app,
      auths: { google: auth },
      storage: localStorage,
      locks: null,
      makeProvider: () => ({
        ...cloud.provider,
        // Like the real ones: no token, no sync
        changesSince: async (t) => {
          await auth.token();
          return cloud.provider.changesSince(t);
        },
      }),
      makeEngine: (a, provider) =>
        createSyncEngine({ app: a, provider, debounceMs: 0 }),
    });
}

const openAccount = async (name: RegExp) => {
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog", { name: "Account and sync" });
};

test("without any sign-in set up there's no account button", async () => {
  await renderApp();
  expect(
    screen.queryByRole("button", { name: /sign in to sync/i }),
  ).not.toBeInTheDocument();
});

test("sign in, see it's synced, sign out again", async () => {
  const auth = fakeAuth();
  const { session } = await renderApp("/", undefined, withSession(auth));
  await session?.start();

  let card = await openAccount(/sign in to sync/i);
  expect(within(card).getByText("Sync your tasks")).toBeInTheDocument();
  await userEvent.click(
    within(card).getByRole("button", { name: "Sign in with Google" }),
  );

  card = await screen.findByRole("dialog", { name: "Account and sync" });
  expect(await within(card).findByText("sam@example.com")).toBeInTheDocument();
  expect(within(card).getByText("Google Drive")).toBeInTheDocument();
  expect(
    await within(card).findByText("Up to date with Google Drive."),
  ).toBeInTheDocument();
  expect(
    // Hidden from the accessibility tree while the popover is open
    screen.getByRole("button", {
      name: /signed in as Sam Taylor$/,
      hidden: true,
    }),
  ).toHaveTextContent("ST");

  await userEvent.click(within(card).getByRole("button", { name: "Sign out" }));
  expect(auth.signOut).toHaveBeenCalled();
  expect(
    await within(card).findByRole("button", { name: "Sign in with Google" }),
  ).toBeInTheDocument();
});

test("a sign-in that ran out shows on the button and offers to sign in again", async () => {
  localStorage.setItem(
    "doozly.account",
    JSON.stringify({
      provider: "google",
      id: "1",
      email: "sam@example.com",
      name: "Sam",
    }),
  );
  const auth = fakeAuth("1", "Sam");
  const { session } = await renderApp("/", undefined, withSession(auth));
  await session?.start();

  const card = await openAccount(/needs attention/);
  expect(
    within(card).getByText("Sign in again to keep syncing."),
  ).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Sync now" })).toBeDisabled();
  await userEvent.click(
    within(card).getByRole("button", { name: "Sign in again" }),
  );
  expect(
    await within(card).findByText("Up to date with Google Drive."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /needs attention/, hidden: true }),
  ).not.toBeInTheDocument();
});

test("closing the popup says nothing, other failures say why", async () => {
  const auth = fakeAuth();
  auth.signIn
    .mockRejectedValueOnce(new SignInError("cancelled", "closed"))
    .mockRejectedValueOnce(
      new SignInError("noDriveAccess", "Doozly needs access to its own folder"),
    );
  const { session } = await renderApp("/", undefined, withSession(auth));
  await session?.start();
  const card = await openAccount(/sign in to sync/i);
  const button = within(card).getByRole("button", {
    name: "Sign in with Google",
  });

  await userEvent.click(button);
  expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
  await userEvent.click(button);
  expect(await within(card).findByRole("alert")).toHaveTextContent(
    "Doozly needs access to its own folder",
  );
});

test("another account's tasks on this device need a yes before they go along", async () => {
  localStorage.setItem("doozly.dataOwner", "google:someone-else");
  const auth = fakeAuth();
  const { session } = await renderApp(
    "/",
    (actions) => actions.addTask(INBOX_ID, "Milk"),
    withSession(auth),
  );
  await session?.start();
  const card = await openAccount(/sign in to sync/i);
  await userEvent.click(
    within(card).getByRole("button", { name: "Sign in with Google" }),
  );

  const ask = await screen.findByRole("alertdialog");
  expect(ask).toHaveTextContent("Add them to sam@example.com");
  await userEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  expect(session?.state.getState().account).toBeNull();
});
