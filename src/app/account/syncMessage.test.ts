import { expect, test } from "vitest";
import type { SyncPhase } from "../../sync/engine.ts";
import type { SessionState } from "../../sync/session.ts";
import { syncMessage } from "./syncMessage.ts";

const state = (
  phase: SyncPhase | null,
  extra: Partial<SessionState> = {},
  pending = 0,
): SessionState => ({
  account: { provider: "microsoft", id: "1", email: "a@b.c", name: "A" },
  sync: phase && { phase, lastSyncedAt: null, pending, error: null },
  elsewhere: false,
  signingIn: null,
  ...extra,
});

test("signed out there's nothing to say", () => {
  expect(syncMessage(state("idle", { account: null }))).toBeNull();
});

test("every phase has words, and only real trouble asks for attention", () => {
  expect(syncMessage(state("idle"))).toMatchObject({
    text: "Up to date with OneDrive.",
    attention: false,
  });
  expect(syncMessage(state("idle", {}, 3))?.text).toBe(
    "3 changes waiting to sync.",
  );
  expect(syncMessage(state("syncing"))?.text).toBe("Syncing…");
  expect(syncMessage(state("offline", {}, 1))).toMatchObject({
    icon: "offline",
    attention: false,
  });
  expect(syncMessage(state("offline", {}, 1))?.text).toMatch(
    /1 change waiting/,
  );
  expect(syncMessage(state("signedOut"))).toMatchObject({
    attention: true,
    action: "signIn",
  });
  expect(syncMessage(state("newerApp"))).toMatchObject({
    attention: true,
    action: "reload",
  });
  expect(syncMessage(state("error"))?.text).toMatch(
    /OneDrive couldn't be read/,
  );
  expect(syncMessage(state("noStorage"))).toMatchObject({
    text: expect.stringMatching(/has no OneDrive/),
    attention: true,
  });
  expect(syncMessage(state(null, { elsewhere: true }))?.text).toBe(
    "Syncing in another Doozly tab.",
  );
});
