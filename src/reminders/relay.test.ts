// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  fromBase64,
  importReminderKey,
  newReminderKey,
  open,
} from "./crypto.ts";
import { createRelay, createRelayScheduler, RelayError } from "./relay.ts";
import type { Reminder } from "./reminders.ts";

const NOW = new Date(2026, 10, 20, 9).getTime();

const reminder = (id: string, inMinutes: number, title = id): Reminder => ({
  id,
  taskId: id,
  listId: "inbox",
  fireAt: NOW + inMinutes * 60_000,
  title,
  body: "Tasks",
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

test("a 401 gets a new session once, then tries again", async () => {
  const answers = [401, 204];
  const calls: RequestInit[] = [];
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(null, { status: answers.shift() ?? 500 });
  });
  const renewSession = vi.fn(async () => true);
  const relay = createRelay({ url: "https://api", renewSession, fetch });

  await relay.putReminders([]);
  expect(renewSession).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]?.[0]).toBe("https://api/v1/reminders");
  expect(calls[0]).toMatchObject({ method: "PUT", credentials: "include" });

  // Without a way to a session it gives up with the 401
  const stuck = createRelay({
    url: "https://api",
    renewSession: async () => false,
    fetch: async () => new Response(null, { status: 401 }),
  });
  await expect(stuck.putReminders([])).rejects.toEqual(new RelayError(401));
});

async function setup() {
  const raw = newReminderKey();
  // Imported once, so only sealing waits on WebCrypto
  const imported = await importReminderKey(raw);
  const puts: { id: string; fireAt: number; payload: string }[][] = [];
  let fail = false;
  const relay = {
    putReminders: vi.fn(async (r: (typeof puts)[number]) => {
      if (fail) throw new RelayError(503);
      puts.push(r);
    }),
  };
  const key = async () => ({ raw, key: imported });
  const scheduler = createRelayScheduler({ relay, key, wait: 1000 });
  // Sealing runs on Node's thread pool, which fake timers don't wait for
  const sent = (n: number) =>
    vi.waitFor(() => expect(relay.putReminders).toHaveBeenCalledTimes(n));
  return {
    puts,
    relay,
    scheduler,
    imported,
    sent,
    failing: (v: boolean) => {
      fail = v;
    },
  };
}

test("sends the coming reminders sealed, after a pause in typing", async () => {
  const { puts, scheduler, imported, sent } = await setup();
  await scheduler.sync([reminder("a", 10, "Ca")]);
  await scheduler.sync([reminder("a", 10, "Cal"), reminder("old", -5)]);
  await vi.advanceTimersByTimeAsync(999);
  expect(puts).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  await sent(1);

  const [only] = puts[0] ?? [];
  expect(puts[0]).toHaveLength(1);
  expect(only).toMatchObject({ id: "a", fireAt: NOW + 600_000 });
  const content = await open(imported, "a", fromBase64(only?.payload ?? ""));
  expect(content).toEqual({
    title: "Cal",
    list: "Tasks",
    taskId: "a",
    listId: "inbox",
  });
});

test("the same set isn't sent again, until an hour went by", async () => {
  const { relay, scheduler, sent } = await setup();
  await scheduler.sync([reminder("a", 120)]);
  await vi.advanceTimersByTimeAsync(1000);
  await sent(1);
  await scheduler.sync([reminder("a", 120)]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(relay.putReminders).toHaveBeenCalledOnce();

  vi.setSystemTime(Date.now() + 61 * 60_000);
  await scheduler.sync([reminder("a", 120)]);
  await vi.advanceTimersByTimeAsync(1000);
  await sent(2);
});

test("a failed send is tried again later", async () => {
  const { puts, scheduler, failing, sent } = await setup();
  failing(true);
  await scheduler.sync([reminder("a", 120)]);
  await vi.advanceTimersByTimeAsync(1000);
  await sent(1);
  expect(puts).toHaveLength(0);
  failing(false);
  await vi.advanceTimersByTimeAsync(60_000);
  await sent(2);
  expect(puts).toHaveLength(1);
});

test("an emptied set is sent too, so the relay forgets them", async () => {
  const { puts, scheduler, sent } = await setup();
  await scheduler.sync([reminder("a", 120)]);
  await vi.advanceTimersByTimeAsync(1000);
  await sent(1);
  await scheduler.sync([]);
  await vi.advanceTimersByTimeAsync(1000);
  await sent(2);
  expect(puts.map((p) => p.length)).toEqual([1, 0]);
});

test("dispose stops it", async () => {
  const { relay, scheduler } = await setup();
  await scheduler.sync([reminder("a", 120)]);
  scheduler.dispose();
  await vi.advanceTimersByTimeAsync(5000);
  expect(relay.putReminders).not.toHaveBeenCalled();
});
