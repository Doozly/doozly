import { afterEach, expect, test, vi } from "vitest";
import { browserPopup } from "./auth.ts";
import { answerDropbox, DROPBOX_CHANNEL } from "./popup.ts";

afterEach(() => {
  vi.useRealTimers();
});

test("the redirect page passes only Dropbox's answers on", async () => {
  const listen = new BroadcastChannel(DROPBOX_CHANNEL);
  const got = new Promise<unknown>((resolve) => {
    listen.onmessage = (e) => resolve(e.data);
  });
  // MSAL's answer has a state of its own
  expect(answerDropbox("?code=x&state=eyJpZCI6")).toBe(false);
  expect(answerDropbox("?code=abc&state=dropbox.s1")).toBe(true);
  expect(await got).toEqual({
    state: "dropbox.s1",
    code: "abc",
    error: undefined,
    errorDescription: undefined,
  });
  listen.close();
});

test("the app takes the answer for its own state", async () => {
  const waiting = browserPopup.answer("dropbox.mine");
  answerDropbox("?code=theirs&state=dropbox.other");
  answerDropbox("?code=ours&state=dropbox.mine");
  expect(await waiting).toMatchObject({ code: "ours" });
});

test("back in the app without an answer counts as a closed window", async () => {
  vi.useFakeTimers();
  const waiting = browserPopup.answer("dropbox.s");
  const outcome = waiting.catch((e: unknown) => e);
  // A quick look back at the app and off again is no cancel
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("blur"));
  await vi.advanceTimersByTimeAsync(5_000);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(1_500);
  expect(await outcome).toMatchObject({ reason: "cancelled" });
});
