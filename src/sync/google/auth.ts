import { AuthError, ProviderError, SignInError } from "../provider.ts";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SCOPES = [DRIVE_SCOPE, "openid", "email", "profile"].join(" ");
const GIS_SRC = "https://accounts.google.com/gsi/client";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
// Count a token as gone a minute early, so no request sets off with one about to die
const MARGIN_MS = 60_000;

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  error?: string;
  error_description?: string;
}

export interface CodeResponse {
  code?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: {
    prompt?: string;
    login_hint?: string;
  }): void;
}

/** The bit of Google Identity Services we use */
export interface Gis {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes?: boolean;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string; message?: string }) => void;
  }): TokenClient;
  initCodeClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes?: boolean;
    ux_mode: "popup";
    login_hint?: string;
    callback: (response: CodeResponse) => void;
    error_callback?: (error: { type: string; message?: string }) => void;
  }): { requestCode(): void };
  hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
}

export interface GoogleAccount {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

let gisScript: Promise<Gis> | undefined;

/** Adds Google's script to the page once */
export function loadGis(): Promise<Gis> {
  gisScript ??= new Promise<Gis>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const gis = (window as { google?: { accounts?: { oauth2?: Gis } } })
        .google?.accounts?.oauth2;
      if (gis) resolve(gis);
      else reject(new Error("Google sign-in loaded without its oauth2 part"));
    };
    script.onerror = () => {
      gisScript = undefined;
      script.remove();
      reject(new Error("Couldn't load Google sign-in"));
    };
    document.head.append(script);
  });
  return gisScript;
}

interface AuthOptions {
  clientId: string;
  /** With the relay, sign-in uses the code flow and the relay refreshes the token, so it lasts */
  relayUrl?: string;
  load?: () => Promise<Gis>;
  fetch?: typeof fetch;
  now?: () => number;
}

interface RelayToken {
  accessToken: string;
  expiresIn: number;
}

const noDrive = () =>
  new SignInError(
    "noDriveAccess",
    "Doozly needs access to its own folder in Google Drive to sync",
  );

// popup_closed is the user changing their mind, popup_failed_to_open a blocker
const popupError = (error: { type: string; message?: string }) =>
  new SignInError(
    error.type === "popup_closed" ? "cancelled" : "failed",
    error.message ?? error.type,
  );

const answerError = (error: string, description?: string) =>
  new SignInError(
    error === "access_denied" ? "cancelled" : "failed",
    description ?? error,
  );

/** Google sign-in. Alone an SPA gets an hour's token; with the relay a code, and the relay keeps a refresh token. */
export function createGoogleAuth({
  clientId,
  relayUrl,
  load = loadGis,
  fetch: fetchImpl = (...args) => fetch(...args),
  now = Date.now,
}: AuthOptions) {
  let account: GoogleAccount | null = null;
  let token: { value: string; expiresAt: number } | null = null;
  let refreshing: Promise<string> | null = null;

  function requestToken(gis: Gis, hint?: string): Promise<TokenResponse> {
    return new Promise((resolve, reject) => {
      const client = gis.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        include_granted_scopes: true,
        callback: (response) => {
          if (response.error) {
            reject(answerError(response.error, response.error_description));
          } else resolve(response);
        },
        error_callback: (error) => reject(popupError(error)),
      });
      client.requestAccessToken(hint ? { login_hint: hint } : undefined);
    });
  }

  function requestCode(gis: Gis, hint?: string): Promise<CodeResponse> {
    return new Promise((resolve, reject) => {
      gis
        .initCodeClient({
          client_id: clientId,
          scope: SCOPES,
          include_granted_scopes: true,
          ux_mode: "popup",
          login_hint: hint,
          callback: (response) => {
            if (response.error || !response.code) {
              reject(
                answerError(
                  response.error ?? "no code",
                  response.error_description,
                ),
              );
            } else resolve(response);
          },
          error_callback: (error) => reject(popupError(error)),
        })
        .requestCode();
    });
  }

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

  const keep = (t: RelayToken) => {
    token = { value: t.accessToken, expiresAt: now() + t.expiresIn * 1000 };
    return t.accessToken;
  };

  /** A new access token from the relay. Calls at the same time share one request. */
  function refresh(): Promise<string> {
    refreshing ??= (async () => {
      try {
        const res = await relay("/v1/auth/google/refresh", { method: "POST" });
        if (res.status === 401) {
          throw new AuthError(
            account ? "Google sign-in ran out" : "Not signed in to Google",
          );
        }
        if (!res.ok)
          throw new ProviderError(`The relay answered ${res.status}`);
        return keep((await res.json()) as RelayToken);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function fetchAccount(accessToken: string): Promise<GoogleAccount> {
    const res = await fetchImpl(USERINFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new SignInError("failed", `userinfo answered ${res.status}`);
    }
    const info = (await res.json()) as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    return {
      id: info.sub,
      email: info.email ?? "",
      name: info.name ?? info.email ?? "",
      picture: info.picture,
    };
  }

  /** The code flow: Google's popup gives a code, the relay swaps it for tokens and keeps the refresh token */
  async function signInWithRelay(gis: Gis): Promise<string> {
    const code = await requestCode(gis, account?.email);
    // With granular consent the user can untick Drive and still say yes
    if (!code.scope?.split(" ").includes(DRIVE_SCOPE)) throw noDrive();
    let res: Response;
    try {
      res = await relay("/v1/auth/google/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.code }),
      });
    } catch (err) {
      throw new SignInError("failed", String(err));
    }
    if (!res.ok) {
      throw new SignInError("failed", `The relay answered ${res.status}`);
    }
    return keep((await res.json()) as RelayToken);
  }

  async function signInAlone(gis: Gis): Promise<string> {
    const response = await requestToken(gis, account?.email);
    if (!gis.hasGrantedAllScopes(response, DRIVE_SCOPE)) throw noDrive();
    return keep({
      accessToken: response.access_token,
      expiresIn: response.expires_in,
    });
  }

  return {
    /** Load Google's script early, so signIn() opens its popup while the click still counts */
    preload: () => load(),

    /** Opens Google's popup. Call it from a click, or the browser blocks the popup. */
    async signIn(): Promise<GoogleAccount> {
      const gis = await load();
      token = null;
      const accessToken = relayUrl
        ? await signInWithRelay(gis)
        : await signInAlone(gis);
      account = await fetchAccount(accessToken);
      return account;
    },

    /** Only with the relay: picks up the sign-in from last time through the refresh cookie. null when there's none. */
    restore: relayUrl
      ? async (): Promise<GoogleAccount | null> => {
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
        account ? "Google sign-in ran out" : "Not signed in to Google",
      );
    },

    /** Google said no to the token, so it's no good any more, however long it should have lasted */
    expire() {
      token = null;
    },

    /** Who signed in last, even when their token ran out */
    account: () => account,

    /** Forgets the sign-in here. No revoke: that ends the whole grant, also on the user's other devices. */
    async signOut() {
      token = null;
      account = null;
      if (relayUrl) {
        await relay("/v1/auth/google", { method: "DELETE" }).catch(() => {});
      }
    },
  };
}

export type GoogleAuth = ReturnType<typeof createGoogleAuth>;
