import { AuthError, ProviderError, SignInError } from "../provider.ts";
import { DROPBOX_CHANNEL, type PopupAnswer, STATE_PREFIX } from "./popup.ts";

const AUTHORIZE = "https://www.dropbox.com/oauth2/authorize";
export const DROPBOX_TOKEN = "https://api.dropboxapi.com/oauth2/token";
export const DROPBOX_ACCOUNT =
  "https://api.dropboxapi.com/2/users/get_current_account";
export const DROPBOX_REVOKE = "https://api.dropboxapi.com/2/auth/token/revoke";
export const WRITE_SCOPE = "files.content.write";
const SCOPES = [
  "account_info.read",
  "files.metadata.read",
  "files.content.read",
  WRITE_SCOPE,
  "openid",
  "email",
  "profile",
].join(" ");
export const REDIRECT_PATH = "/redirect.html";
// Count a token as gone a minute early, so no request sets off with one about to die
const MARGIN_MS = 60_000;
// Enough for a password and a 2FA code
const WAIT_MS = 180_000;
// The popup sends its answer before it closes, so being back here this long without one means it was closed
const BACK_MS = 1_500;

export interface DropboxAccount {
  id: string;
  email: string;
  name: string;
}

/** The sign-in window. Dropbox cuts it off from us (COOP), so `closed` and `opener` can't be trusted. */
export interface Popup {
  /** A blank window right away, while the click still counts. null when it was blocked. */
  open(): { go(url: string): void; close(): void } | null;
  /** Dropbox's answer for this state. Rejects as cancelled when the user comes back without one. */
  answer(state: string): Promise<PopupAnswer>;
}

const cancelled = () => new SignInError("cancelled", "Sign-in was cancelled");

export const browserPopup: Popup = {
  open() {
    const w = window.open("", "doozly-dropbox", "popup,width=520,height=700");
    if (!w) return null;
    return {
      go: (url) => {
        w.location.href = url;
      },
      close: () => {
        try {
          w.close();
        } catch {
          // Cut off already, the redirect page closes itself
        }
      },
    };
  },

  answer(state) {
    return new Promise((resolve, reject) => {
      const channel = new BroadcastChannel(DROPBOX_CHANNEL);
      let back: ReturnType<typeof setTimeout> | undefined;
      const onFocus = () => {
        clearTimeout(back);
        back = setTimeout(stop, BACK_MS);
      };
      const onBlur = () => clearTimeout(back);
      const done = () => {
        channel.close();
        clearTimeout(back);
        clearTimeout(timeout);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
      };
      function stop() {
        done();
        reject(cancelled());
      }
      const timeout = setTimeout(stop, WAIT_MS);
      channel.onmessage = (e: MessageEvent<PopupAnswer>) => {
        if (e.data?.state !== state) return;
        done();
        resolve(e.data);
      };
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
    });
  },
};

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return b64url(new Uint8Array(digest));
}

interface AuthOptions {
  clientId: string;
  /** With the relay the sign-in lasts, it keeps the refresh token. Alone it's 4 hours. */
  relayUrl?: string;
  popup?: Popup;
  fetch?: typeof fetch;
  now?: () => number;
  origin?: string;
}

interface Granted {
  accessToken: string;
  expiresIn: number;
  scope?: string;
}

const noDrive = () =>
  new SignInError(
    "noDriveAccess",
    "Doozly needs access to its own folder in Dropbox to sync",
  );

/** Dropbox sign-in: a PKCE popup. With the relay it swaps the code and keeps the refresh token in a cookie. */
export function createDropboxAuth({
  clientId,
  relayUrl,
  popup = browserPopup,
  fetch: fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  origin = typeof location === "undefined" ? "" : location.origin,
}: AuthOptions) {
  const redirectUri = `${origin}${REDIRECT_PATH}`;
  let account: DropboxAccount | null = null;
  let token: { value: string; expiresAt: number } | null = null;
  let refreshing: Promise<string> | null = null;

  async function relay(path: string, init: RequestInit = {}) {
    try {
      return await fetchImpl(`${relayUrl}${path}`, {
        ...init,
        credentials: "include",
      });
    } catch (err) {
      throw new ProviderError(`Can't reach the Doozly relay: ${String(err)}`);
    }
  }

  const keep = (t: Granted) => {
    token = { value: t.accessToken, expiresAt: now() + t.expiresIn * 1000 };
    return t.accessToken;
  };

  /** A new access token from the relay. Calls at the same time share one request. */
  function refresh(): Promise<string> {
    refreshing ??= (async () => {
      try {
        const res = await relay("/v1/auth/dropbox/refresh", { method: "POST" });
        if (res.status === 401) {
          throw new AuthError(
            account ? "Dropbox sign-in ran out" : "Not signed in to Dropbox",
          );
        }
        if (!res.ok)
          throw new ProviderError(`The relay answered ${res.status}`);
        return keep((await res.json()) as Granted);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function fetchAccount(accessToken: string): Promise<DropboxAccount> {
    const res = await fetchImpl(DROPBOX_ACCOUNT, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new SignInError(
        "failed",
        `get_current_account answered ${res.status}`,
      );
    }
    const info = (await res.json()) as {
      account_id: string;
      email?: string;
      name?: { display_name?: string };
    };
    return {
      id: info.account_id,
      email: info.email ?? "",
      name: info.name?.display_name || info.email || "",
    };
  }

  /** Swaps the code, through the relay when there is one so the refresh token stays there */
  async function exchange(code: string, verifier: string): Promise<Granted> {
    let res: Response;
    try {
      res = relayUrl
        ? await relay("/v1/auth/dropbox/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, verifier, redirectUri }),
          })
        : await fetchImpl(DROPBOX_TOKEN, {
            method: "POST",
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              code_verifier: verifier,
              client_id: clientId,
              redirect_uri: redirectUri,
            }),
          });
    } catch (err) {
      throw new SignInError("failed", String(err));
    }
    if (!res.ok) {
      throw new SignInError(
        "failed",
        `The code exchange answered ${res.status}`,
      );
    }
    if (relayUrl) return (await res.json()) as Granted;
    const t = (await res.json()) as {
      access_token: string;
      expires_in: number;
      scope?: string;
    };
    return {
      accessToken: t.access_token,
      expiresIn: t.expires_in,
      scope: t.scope,
    };
  }

  return {
    /** Opens Dropbox's popup. Call it from a click, or the browser blocks the popup. */
    async signIn(): Promise<DropboxAccount> {
      // Before any await, so the click still counts
      const win = popup.open();
      if (!win) {
        throw new SignInError("failed", "The sign-in window was blocked");
      }
      try {
        const verifier = random(32);
        const state = STATE_PREFIX + random(16);
        const params = new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          redirect_uri: redirectUri,
          code_challenge: await challenge(verifier),
          code_challenge_method: "S256",
          state,
          scope: SCOPES,
          // A refresh token only for the relay, the browser shouldn't hold one
          token_access_type: relayUrl ? "offline" : "online",
        });
        win.go(`${AUTHORIZE}?${params}`);
        const answer = await popup.answer(state);
        if (answer.error === "access_denied") throw cancelled();
        if (answer.error || !answer.code) {
          throw new SignInError(
            "failed",
            answer.errorDescription ?? answer.error ?? "no code",
          );
        }
        token = null;
        const granted = await exchange(answer.code, verifier);
        if (!granted.scope?.split(" ").includes(WRITE_SCOPE)) throw noDrive();
        account = await fetchAccount(keep(granted));
        return account;
      } finally {
        win.close();
      }
    },

    /** Only with the relay: picks up the sign-in from last time through the refresh cookie. null when there's none. */
    restore: relayUrl
      ? async (): Promise<DropboxAccount | null> => {
          try {
            account = await fetchAccount(await refresh());
            return account;
          } catch (err) {
            if (err instanceof AuthError) return null;
            throw err;
          }
        }
      : undefined,

    /** A token that's good for a while yet, refreshed through the relay when there is one. AuthError means sign in again. */
    async token(): Promise<string> {
      if (token && now() < token.expiresAt - MARGIN_MS) return token.value;
      token = null;
      if (relayUrl) return refresh();
      throw new AuthError(
        account ? "Dropbox sign-in ran out" : "Not signed in to Dropbox",
      );
    },

    /** A refresh through the relay renews its session too */
    relaySession: relayUrl
      ? async (): Promise<boolean> => {
          try {
            await refresh();
            return true;
          } catch {
            return false;
          }
        }
      : undefined,

    /** Dropbox said no to the token, so it's no good any more */
    expire() {
      token = null;
    },

    account: () => account,

    /** Revokes this sign-in's grant at Dropbox. Other devices have their own, they stay signed in. */
    async signOut() {
      const last = token && now() < token.expiresAt ? token.value : null;
      token = null;
      account = null;
      if (last) {
        await fetchImpl(DROPBOX_REVOKE, {
          method: "POST",
          headers: { Authorization: `Bearer ${last}` },
        }).catch(() => {});
      }
      if (relayUrl) {
        await relay("/v1/auth/dropbox", { method: "DELETE" }).catch(() => {});
      }
    },
  };
}

export type DropboxAuth = ReturnType<typeof createDropboxAuth>;
