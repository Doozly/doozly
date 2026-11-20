// @vitest-environment node
import { expect, test, vi } from "vitest";
import { importReminderKey, newReminderKey, seal, toBase64 } from "./crypto.ts";
import { openFromNotification, showReminder } from "./pushMessages.ts";

const content = {
  title: "Call the dentist",
  list: "Tasks",
  taskId: "t 1",
  listId: "inbox",
};

async function sealed(id = "t1@1") {
  const key = await importReminderKey(newReminderKey());
  return { key, data: { id, payload: toBase64(await seal(key, id, content)) } };
}

test("a push opens with the key and shows the task", async () => {
  const { key, data } = await sealed();
  const show = vi.fn(async () => {});
  await showReminder(data, { key: async () => key, show });
  expect(show).toHaveBeenCalledWith("Call the dentist", {
    body: "Tasks",
    tag: "t1@1",
    icon: "/icon-192.png",
    data: { path: "/lists/inbox/tasks/t%201" },
  });
});

test("no key, a wrong key or rubbish still shows a plain reminder", async () => {
  const { data } = await sealed();
  const other = await importReminderKey(newReminderKey());
  const show = vi.fn(async () => {});
  await showReminder(data, { key: async () => null, show });
  await showReminder(data, { key: async () => other, show });
  await showReminder(data, {
    key: async () => {
      throw new Error("no IndexedDB");
    },
    show,
  });
  await showReminder("rubbish", { key: async () => other, show });
  for (const [title, options] of show.mock.calls as unknown as [
    string,
    NotificationOptions,
  ][]) {
    expect(title).toBe("Reminder");
    expect(options.data).toEqual({ path: "/" });
  }
  expect(show).toHaveBeenCalledTimes(4);
});

test("a click focuses an open Doozly and sends it to the task", async () => {
  const win = { focus: vi.fn(async () => {}), postMessage: vi.fn() };
  const openWindow = vi.fn(async () => {});
  await openFromNotification(
    { path: "/lists/inbox/tasks/t1" },
    { windows: async () => [win], openWindow },
  );
  expect(win.focus).toHaveBeenCalled();
  expect(win.postMessage).toHaveBeenCalledWith({
    type: "doozly:open",
    path: "/lists/inbox/tasks/t1",
  });
  expect(openWindow).not.toHaveBeenCalled();
});

test("with no window open it opens one, and only on our own paths", async () => {
  const openWindow = vi.fn(async (_path: string) => {});
  const none = { windows: async () => [], openWindow };
  await openFromNotification({ path: "/lists/inbox" }, none);
  await openFromNotification({ path: "https://evil.example" }, none);
  await openFromNotification({ path: "//evil.example" }, none);
  await openFromNotification({ path: "/\\evil.example" }, none);
  await openFromNotification(null, none);
  expect(openWindow.mock.calls.map(([p]) => p)).toEqual([
    "/lists/inbox",
    "/",
    "/",
    "/",
    "/",
  ]);
});
