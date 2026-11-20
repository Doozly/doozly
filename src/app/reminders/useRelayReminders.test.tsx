import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { fromBase64, importReminderKey, open } from "../../reminders/crypto.ts";
import type { Reminder } from "../../reminders/reminders.ts";
import { AppProvider } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import type { Session, SessionState } from "../../sync/session.ts";
import { testApp } from "../../test/app.ts";
import { SessionProvider } from "../account/SessionContext.tsx";
import { useRelayReminders } from "./useRelayReminders.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const soon: Reminder = {
  id: "t1@1",
  taskId: "t1",
  listId: "inbox",
  fireAt: Date.now() + 3_600_000,
  title: "Call the dentist",
  body: "Tasks",
};

async function setup(lastSyncedAt: number | null) {
  const t = await testApp();
  const state = createStore<SessionState>()(() => ({
    account: { provider: "google", id: "1", email: "", name: "" },
    sync: { phase: "idle", lastSyncedAt, pending: 0, error: null },
    elsewhere: false,
    signingIn: null,
  }));
  const session = { state, renewRelay: async () => true } as unknown as Session;
  const puts: { reminders: { id: string; payload: string }[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      puts.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProvider value={{ app: t.app, actions: t.actions }}>
      <SessionProvider value={session}>{children}</SessionProvider>
    </AppProvider>
  );
  const hook = renderHook(
    () => useRelayReminders([soon], { url: "https://api", wait: 0 }),
    { wrapper },
  );
  return { ...t, state, puts, hook };
}

test("after the first pull, a key is made and the sealed set goes to the relay", async () => {
  const { app, puts } = await setup(1);
  await waitFor(() => expect(puts).toHaveLength(1));

  const raw = setting(app.store.getState(), "reminderKey");
  expect(raw).not.toBe("");
  const [sent] = puts[0]?.reminders ?? [];
  const content = await open(
    await importReminderKey(raw),
    "t1@1",
    fromBase64(sent?.payload ?? ""),
  );
  expect(content?.title).toBe("Call the dentist");
});

test("nothing before the first pull, so no second key gets made", async () => {
  const { app, puts, state } = await setup(null);
  await new Promise((r) => setTimeout(r, 50));
  expect(puts).toHaveLength(0);
  expect(setting(app.store.getState(), "reminderKey")).toBe("");

  act(() => {
    state.setState({
      sync: { phase: "idle", lastSyncedAt: 1, pending: 0, error: null },
    });
  });
  await waitFor(() => expect(puts).toHaveLength(1));
});

test("a key from another device seals it all again", async () => {
  const { actions, puts } = await setup(1);
  await waitFor(() => expect(puts).toHaveLength(1));
  act(() => {
    actions.setSetting("reminderKey", btoa("x".repeat(32)));
  });
  await waitFor(() => expect(puts).toHaveLength(2));
});
