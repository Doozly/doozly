import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import * as push from "../../reminders/push.ts";
import type { Session, SessionState } from "../../sync/session.ts";
import { SessionProvider } from "../account/SessionContext.tsx";
import { PushSection } from "./PushSection.tsx";

vi.mock("../../reminders/push.ts", async (original) => ({
  ...(await original<typeof push>()),
  pushSubscribed: vi.fn(async () => false),
  subscribePush: vi.fn(async () => {}),
  unsubscribePush: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.mocked(push.pushSubscribed).mockResolvedValue(false);
  vi.mocked(push.subscribePush).mockReset();
  vi.mocked(push.unsubscribePush).mockReset();
});

function show(
  props: Parameters<typeof PushSection>[0],
  { signedIn = true } = {},
) {
  const state = createStore<SessionState>()(() => ({
    account: signedIn
      ? { provider: "google", id: "1", email: "", name: "" }
      : null,
    sync: null,
    elsewhere: false,
    signingIn: null,
  }));
  const session = { state, renewRelay: async () => true } as unknown as Session;
  return render(
    <SessionProvider value={session}>
      <PushSection {...props} />
    </SessionProvider>,
  );
}

test("without a relay there's nothing to switch on", () => {
  const { container } = show({ url: undefined, support: "ok" });
  expect(container).toBeEmptyDOMElement();
});

test("the desktop app has no web push", () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  try {
    const { container } = show({ url: "https://api", support: "ok" });
    expect(container).toBeEmptyDOMElement();
  } finally {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
});

test("signed out, it says to sign in", () => {
  show({ url: "https://api", support: "ok" }, { signedIn: false });
  expect(screen.getByText(/Sign in to get reminders/)).toBeVisible();
  expect(screen.queryByRole("switch")).toBeNull();
});

test("on an iPhone in Safari it explains the Home Screen", () => {
  show({ url: "https://api", support: "install" });
  expect(screen.getByText(/Add to Home Screen/)).toBeVisible();
  expect(screen.queryByRole("switch")).toBeNull();
});

test("the switch subscribes and unsubscribes this device", async () => {
  show({ url: "https://api", support: "ok" });
  const toggle = screen.getByRole("switch", {
    name: "Remind me when Doozly is closed",
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).not.toBeChecked();

  await userEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
  expect(push.subscribePush).toHaveBeenCalledOnce();

  await userEvent.click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(push.unsubscribePush).toHaveBeenCalledOnce();
});

test("blocked notifications say how to fix it, and the switch stays off", async () => {
  vi.mocked(push.subscribePush).mockRejectedValue(new push.PushBlockedError());
  show({ url: "https://api", support: "ok" });
  const toggle = screen.getByRole("switch");
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /blocked for Doozly/,
  );
  expect(toggle).not.toBeChecked();
});

test("without a service worker it says so instead of hanging", async () => {
  vi.mocked(push.subscribePush).mockRejectedValue(new push.NoWorkerError());
  show({ url: "https://api", support: "ok" });
  const toggle = screen.getByRole("switch");
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /can't receive notifications/,
  );
  expect(toggle).not.toBeChecked();
});

test("it shows when this device is subscribed already", async () => {
  vi.mocked(push.pushSubscribed).mockResolvedValue(true);
  show({ url: "https://api", support: "ok" });
  await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
});

test("it doesn't ask the browser about a subscription that can't exist", () => {
  // Some WebKit builds never answer getSubscription(), which freezes the page
  vi.mocked(push.pushSubscribed).mockClear();
  show({ url: undefined, support: "ok" });
  show({ url: "https://api", support: "ok" }, { signedIn: false });
  show({ url: "https://api", support: "install" });
  expect(push.pushSubscribed).not.toHaveBeenCalled();
});
