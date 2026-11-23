import { expect, test, vi } from "vitest";
import { AuthError, ProviderError, SignInError } from "../provider.ts";
import { createDesktopAuth } from "./auth.ts";

const profile = {
  id: "o.t",
  email: "sam@contoso.com",
  name: "Sam",
  work: true,
};

test("signing in and tokens go through the Rust commands, for that provider", async () => {
  const invoke = vi.fn(async (cmd: string) =>
    cmd === "sign_in" ? profile : cmd === "access_token" ? "at" : null,
  );
  const auth = createDesktopAuth("microsoft", invoke as never);

  expect(await auth.signIn()).toEqual(profile);
  expect(await auth.token()).toBe("at");
  expect(await auth.restore?.()).toBeNull();
  await auth.signOut();
  expect(invoke.mock.calls).toEqual([
    ["sign_in", { provider: "microsoft" }],
    ["access_token", { provider: "microsoft" }],
    ["restored_account", { provider: "microsoft" }],
    ["sign_out", { provider: "microsoft" }],
  ]);
});

test("Rust's errors become the ones the session knows", async () => {
  const failing = (kind: string, message?: string) =>
    createDesktopAuth("google", (async () => {
      throw { kind, message };
    }) as never);

  await expect(failing("cancelled").signIn()).rejects.toMatchObject({
    reason: "cancelled",
  });
  const noDrive = await failing("noDriveAccess")
    .signIn()
    .catch((e: unknown) => e);
  expect(noDrive).toBeInstanceOf(SignInError);
  expect(noDrive).toMatchObject({ reason: "noDriveAccess" });
  expect((noDrive as Error).message).toContain("Google Drive");
  await expect(failing("failed", "boom").signIn()).rejects.toMatchObject({
    reason: "failed",
    message: "boom",
  });

  await expect(failing("signedOut").token()).rejects.toBeInstanceOf(AuthError);
  const offline = await failing("network", "no route")
    .token()
    .catch((e: unknown) => e);
  expect(offline).toBeInstanceOf(ProviderError);
  expect(offline).not.toBeInstanceOf(AuthError);
  expect((offline as ProviderError).retryable).toBe(true);
  const broken = await failing("failed", "bad config")
    .token()
    .catch((e: unknown) => e);
  expect((broken as ProviderError).retryable).toBe(false);
});

test("a refused token is dropped on the Rust side, quietly", async () => {
  const invoke = vi.fn(async () => {
    throw new Error("gone");
  });
  createDesktopAuth("google", invoke as never).expire?.();
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledWith("drop_access_token", {
    provider: "google",
  });
});
