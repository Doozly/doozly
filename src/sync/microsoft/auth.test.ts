import type { AccountInfo, AuthenticationResult } from "@azure/msal-browser";
import { expect, test, vi } from "vitest";
import { AuthError, ProviderError } from "../provider.ts";
import { APP_FOLDER_SCOPE, createMicrosoftAuth, type Msal } from "./auth.ts";

const personal: AccountInfo = {
  homeAccountId: "home-1",
  environment: "login.microsoftonline.com",
  tenantId: "9188040d-6c67-4c5b-b112-36a304b66dad",
  username: "sam@outlook.com",
  localAccountId: "1",
  name: "Sam",
};
const work: AccountInfo = {
  ...personal,
  homeAccountId: "home-2",
  tenantId: "contoso",
  username: "sam@contoso.com",
};

const result = (account: AccountInfo, scopes = [APP_FOLDER_SCOPE]) =>
  ({ account, scopes, accessToken: "tok" }) as unknown as AuthenticationResult;

const msalError = (errorCode: string) =>
  Object.assign(new Error(errorCode), { errorCode });

/** MSAL with a cache, and popups that already know what the user clicks */
function fakeMsal(cached: AccountInfo[] = []) {
  let active: AccountInfo | null = null;
  const m = {
    loginPopup: vi.fn(async () => result(personal)),
    acquireTokenPopup: vi.fn(async () => result(personal)),
    acquireTokenSilent: vi.fn(async () => result(personal)),
    getAllAccounts: () => cached,
    getActiveAccount: () => active,
    setActiveAccount: (a: AccountInfo | null) => {
      active = a;
    },
    clearCache: vi.fn(async () => undefined),
  };
  return m;
}

const setup = (msal = fakeMsal()) => ({
  msal,
  auth: createMicrosoftAuth({
    clientId: "client",
    create: async () => msal as unknown as Msal,
  }),
});

test("signing in gives the account, then tokens come quietly", async () => {
  const { auth, msal } = setup();
  expect(await auth.restore()).toBeNull();
  await expect(auth.token()).rejects.toThrow(AuthError);

  expect(await auth.signIn()).toEqual({
    id: "home-1",
    email: "sam@outlook.com",
    name: "Sam",
    work: false,
  });
  expect(msal.loginPopup).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: "select_account" }),
  );
  expect(await auth.token()).toBe("tok");
});

test("an account from an earlier visit is picked up without a popup", async () => {
  const { auth, msal } = setup(fakeMsal([work]));
  expect(await auth.restore()).toMatchObject({
    email: "sam@contoso.com",
    work: true,
  });
  expect(await auth.token()).toBe("tok");
  expect(msal.loginPopup).not.toHaveBeenCalled();
});

test("when the refresh token runs out, sync waits and signing in again reuses the account", async () => {
  const { auth, msal } = setup(fakeMsal([personal]));
  await auth.restore();
  msal.acquireTokenSilent.mockRejectedValueOnce(
    msalError("interaction_required"),
  );
  await expect(auth.token()).rejects.toThrow("Microsoft sign-in ran out");

  await auth.signIn();
  expect(msal.acquireTokenPopup).toHaveBeenCalledWith(
    expect.objectContaining({ loginHint: "sam@outlook.com" }),
  );
  expect(msal.loginPopup).not.toHaveBeenCalled();
});

test("no network while refreshing is worth another go, not a sign-out", async () => {
  const { auth, msal } = setup(fakeMsal([personal]));
  await auth.restore();
  msal.acquireTokenSilent.mockRejectedValueOnce(
    msalError("no_network_connectivity"),
  );
  const err = await auth.token().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err).not.toBeInstanceOf(AuthError);
});

test("closing the popup is a cancel, a missing scope is no drive access", async () => {
  const { auth, msal } = setup();
  msal.loginPopup.mockRejectedValueOnce(msalError("user_cancelled"));
  await expect(auth.signIn()).rejects.toMatchObject({ reason: "cancelled" });

  msal.loginPopup.mockResolvedValueOnce(result(personal, ["User.Read"]));
  await expect(auth.signIn()).rejects.toMatchObject({
    reason: "noDriveAccess",
  });
  expect(auth.account()).toBeNull();

  msal.loginPopup.mockRejectedValueOnce(msalError("popup_window_error"));
  await expect(auth.signIn()).rejects.toMatchObject({ reason: "failed" });
});

test("signing out forgets the account here", async () => {
  const { auth, msal } = setup();
  await auth.signIn();
  await auth.signOut();
  expect(msal.clearCache).toHaveBeenCalledWith({ account: personal });
  expect(auth.account()).toBeNull();
  await expect(auth.token()).rejects.toThrow("Not signed in to Microsoft");
});
