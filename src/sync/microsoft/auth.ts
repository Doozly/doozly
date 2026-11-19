import type {
  AccountInfo,
  IPublicClientApplication,
} from "@azure/msal-browser";
import { AuthError, ProviderError, SignInError } from "../provider.ts";

export const APP_FOLDER_SCOPE = "Files.ReadWrite.AppFolder";
const SCOPES = [APP_FOLDER_SCOPE];
// Personal Microsoft accounts all live in this one tenant
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
export const REDIRECT_PATH = "/redirect.html";

export interface MicrosoftAccount {
  id: string;
  email: string;
  name: string;
  /** Work or school accounts may not get an app folder, see docs */
  work: boolean;
}

/** The bit of MSAL we use */
export type Msal = Pick<
  IPublicClientApplication,
  | "loginPopup"
  | "acquireTokenSilent"
  | "acquireTokenPopup"
  | "getAllAccounts"
  | "setActiveAccount"
  | "getActiveAccount"
  | "clearCache"
>;

async function createMsal(clientId: string): Promise<Msal> {
  const { createStandardPublicClientApplication } = await import(
    "@azure/msal-browser"
  );
  return createStandardPublicClientApplication({
    auth: {
      clientId,
      authority: "https://login.microsoftonline.com/common",
      redirectUri: `${location.origin}${REDIRECT_PATH}`,
    },
    // MSAL encrypts this with a key in a session cookie, so it's gone with the browser session
    cache: { cacheLocation: "localStorage" },
  });
}

const errorCode = (err: unknown) =>
  typeof err === "object" && err !== null && "errorCode" in err
    ? String(err.errorCode)
    : "";

const toAccount = (a: AccountInfo): MicrosoftAccount => ({
  id: a.homeAccountId,
  email: a.username,
  name: a.name || a.username,
  work: a.tenantId !== CONSUMER_TENANT,
});

function signInFailure(err: unknown): SignInError {
  const code = errorCode(err);
  if (code === "user_cancelled" || code === "access_denied") {
    return new SignInError("cancelled", "Sign-in was cancelled");
  }
  return new SignInError(
    "failed",
    err instanceof Error ? err.message : String(err),
  );
}

interface AuthOptions {
  clientId: string;
  create?: (clientId: string) => Promise<Msal>;
}

/** Microsoft sign-in with MSAL, auth code and PKCE. The refresh token lasts 24 hours, then it needs a popup again. */
export function createMicrosoftAuth({
  clientId,
  create = createMsal,
}: AuthOptions) {
  let msal: Promise<Msal> | undefined;
  const client = () => {
    msal ??= create(clientId);
    return msal;
  };
  let current: AccountInfo | null = null;

  return {
    /** Loads MSAL ahead, so signIn() opens its popup while the click still counts */
    preload: () => client(),

    /** Picks up the account from an earlier visit. Call it at start, and before signIn() so the click still counts. */
    async restore(): Promise<MicrosoftAccount | null> {
      const m = await client();
      current = m.getActiveAccount() ?? m.getAllAccounts()[0] ?? null;
      if (current) m.setActiveAccount(current);
      return current && toAccount(current);
    },

    /** Opens Microsoft's popup. Call it from a click. With an account from before, it's usually one click. */
    async signIn(): Promise<MicrosoftAccount> {
      const m = await client();
      try {
        const result = current
          ? await m.acquireTokenPopup({
              scopes: SCOPES,
              account: current,
              loginHint: current.username,
            })
          : await m.loginPopup({ scopes: SCOPES, prompt: "select_account" });
        if (!result.account) throw new Error("Microsoft gave no account");
        if (
          !result.scopes.some(
            (s) => s.toLowerCase() === APP_FOLDER_SCOPE.toLowerCase(),
          )
        ) {
          throw new SignInError(
            "noDriveAccess",
            "Doozly needs access to its own folder in OneDrive to sync",
          );
        }
        current = result.account;
        m.setActiveAccount(current);
        return toAccount(current);
      } catch (err) {
        throw err instanceof SignInError ? err : signInFailure(err);
      }
    },

    /** A token from MSAL's cache, refreshed quietly. AuthError once only a popup would help. */
    async token(): Promise<string> {
      if (!current) throw new AuthError("Not signed in to Microsoft");
      const m = await client();
      try {
        const result = await m.acquireTokenSilent({
          scopes: SCOPES,
          account: current,
        });
        return result.accessToken;
      } catch (err) {
        const code = errorCode(err);
        if (
          code === "no_network_connectivity" ||
          code === "post_request_failed"
        ) {
          throw new ProviderError("Can't reach Microsoft sign-in");
        }
        throw new AuthError("Microsoft sign-in ran out");
      }
    },

    account: () => current && toAccount(current),

    /** Forgets the account here. Doesn't sign out of Microsoft as a whole. */
    async signOut() {
      const m = await client();
      const old = current;
      current = null;
      if (old) await m.clearCache({ account: old });
    },
  };
}

export type MicrosoftAuth = ReturnType<typeof createMicrosoftAuth>;
