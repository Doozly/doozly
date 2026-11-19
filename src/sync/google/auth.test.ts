import { expect, test, vi } from "vitest";
import { AuthError, ProviderError, SignInError } from "../provider.ts";
import {
  type CodeResponse,
  createGoogleAuth,
  DRIVE_SCOPE,
  type Gis,
  type TokenResponse,
} from "./auth.ts";

type Answer =
  | { response: Partial<TokenResponse & CodeResponse> }
  | { error: { type: string; message?: string } };

const RELAY = "https://relay.test";

/** Google's popup, already decided what the user will click */
function fakeGis(answer: Answer, granted = true) {
  const hints: (string | undefined)[] = [];
  const answerWith = <T>(
    config: {
      callback: (r: T) => void;
      error_callback?: (e: { type: string; message?: string }) => void;
    },
    ok: T,
  ) =>
    queueMicrotask(() => {
      if ("error" in answer) config.error_callback?.(answer.error);
      else config.callback({ ...ok, ...answer.response });
    });
  const gis: Gis = {
    initTokenClient: (config) => ({
      requestAccessToken(overrides) {
        hints.push(overrides?.login_hint);
        answerWith(config, {
          access_token: "tok",
          expires_in: 3600,
          scope: `${DRIVE_SCOPE} openid`,
        });
      },
    }),
    initCodeClient: (config) => ({
      requestCode() {
        hints.push(config.login_hint);
        answerWith(config, {
          code: "the-code",
          scope: granted ? `${DRIVE_SCOPE} openid` : "openid",
        });
      },
    }),
    hasGrantedAllScopes: () => granted,
  };
  return { gis, hints };
}

/** The userinfo endpoint and the relay. `relay.signedIn` is whether its refresh cookie is there. */
function fakeServers() {
  const relay = { signedIn: false, down: false, calls: [] as string[] };
  let refreshes = 0;
  const fetch = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith("/userinfo")) {
        return Response.json({
          sub: "42",
          email: "sam@example.com",
          name: "Sam",
        });
      }
      if (relay.down) throw new TypeError("Failed to fetch");
      const call = `${init.method ?? "GET"} ${url.replace(RELAY, "")}`;
      relay.calls.push(call);
      expect(init.credentials).toBe("include");
      switch (call) {
        case "POST /v1/auth/google/token":
          expect(JSON.parse(String(init.body))).toEqual({ code: "the-code" });
          relay.signedIn = true;
          return Response.json({ accessToken: "relay-tok", expiresIn: 3600 });
        case "POST /v1/auth/google/refresh":
          if (!relay.signedIn) return new Response(null, { status: 401 });
          refreshes++;
          return Response.json({
            accessToken: `fresh-${refreshes}`,
            expiresIn: 3600,
          });
        case "DELETE /v1/auth/google":
          relay.signedIn = false;
          return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    },
  );
  return { fetch, relay };
}

function setup(
  answer: Answer = { response: {} },
  { granted = true, relayUrl }: { granted?: boolean; relayUrl?: string } = {},
) {
  const { gis, hints } = fakeGis(answer, granted);
  const servers = fakeServers();
  let time = 1_000_000;
  const auth = createGoogleAuth({
    clientId: "client",
    relayUrl,
    load: async () => gis,
    fetch: servers.fetch as typeof fetch,
    now: () => time,
  });
  return {
    auth,
    gis,
    hints,
    ...servers,
    later: (ms: number) => {
      time += ms;
    },
  };
}

test("signing in gives the account and a token for about an hour", async () => {
  const { auth, later } = setup();
  await expect(auth.token()).rejects.toThrow(AuthError);
  expect(auth.restore).toBeUndefined();

  expect(await auth.signIn()).toEqual({
    id: "42",
    email: "sam@example.com",
    name: "Sam",
    picture: undefined,
  });
  expect(await auth.token()).toBe("tok");

  later(58 * 60_000);
  expect(await auth.token()).toBe("tok");
  later(60_000);
  await expect(auth.token()).rejects.toThrow("Google sign-in ran out");
  expect(auth.account()?.email).toBe("sam@example.com");
});

test("signing in again suggests the same account", async () => {
  const { auth, hints } = setup();
  await auth.signIn();
  auth.expire();
  await expect(auth.token()).rejects.toThrow(AuthError);
  await auth.signIn();
  expect(hints).toEqual([undefined, "sam@example.com"]);
});

test("closing the popup or saying no is a cancel", async () => {
  for (const answer of [
    { error: { type: "popup_closed" } },
    { response: { error: "access_denied" } },
  ]) {
    const { auth } = setup(answer);
    await expect(auth.signIn()).rejects.toMatchObject({
      name: "SignInError",
      reason: "cancelled",
    });
  }
  const { auth } = setup({ error: { type: "popup_failed_to_open" } });
  await expect(auth.signIn()).rejects.toMatchObject({ reason: "failed" });
});

test("without Drive access there's no sign-in", async () => {
  for (const relayUrl of [undefined, RELAY]) {
    const { auth, relay } = setup(
      { response: {} },
      { granted: false, relayUrl },
    );
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignInError);
    expect(err).toMatchObject({ reason: "noDriveAccess" });
    await expect(auth.token()).rejects.toThrow(AuthError);
    // The code never even goes to the relay
    expect(relay.calls).not.toContain("POST /v1/auth/google/token");
  }
});

test("signing out forgets the account here, and revokes nothing", async () => {
  const { auth, fetch } = setup();
  await auth.signIn();
  fetch.mockClear();
  await auth.signOut();
  expect(fetch).not.toHaveBeenCalled();
  expect(auth.account()).toBeNull();
  await expect(auth.token()).rejects.toThrow("Not signed in to Google");
});

test("with the relay: code flow, then quiet refreshes, so the sign-in lasts", async () => {
  const { auth, relay, later } = setup({ response: {} }, { relayUrl: RELAY });
  expect((await auth.signIn()).email).toBe("sam@example.com");
  expect(await auth.token()).toBe("relay-tok");

  later(60 * 60_000);
  // Two at once share one refresh
  const [a, b] = await Promise.all([auth.token(), auth.token()]);
  expect([a, b]).toEqual(["fresh-1", "fresh-1"]);
  expect(relay.calls.filter((c) => c.includes("refresh"))).toHaveLength(1);
});

test("with the relay, a new page picks the sign-in up again", async () => {
  const first = setup({ response: {} }, { relayUrl: RELAY });
  await first.auth.signIn();

  const { auth, relay } = setup({ response: {} }, { relayUrl: RELAY });
  relay.signedIn = true;
  expect(await auth.restore?.()).toMatchObject({ email: "sam@example.com" });
  expect(await auth.token()).toBe("fresh-1");

  relay.signedIn = false;
  const gone = setup({ response: {} }, { relayUrl: RELAY });
  expect(await gone.auth.restore?.()).toBeNull();
});

test("with the relay: down is worth another go, a dead cookie means sign in again", async () => {
  const { auth, relay, later } = setup({ response: {} }, { relayUrl: RELAY });
  await auth.signIn();
  later(60 * 60_000);

  relay.down = true;
  const err = await auth.token().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err).not.toBeInstanceOf(AuthError);
  await expect(auth.restore?.()).rejects.toThrow(ProviderError);

  relay.down = false;
  relay.signedIn = false;
  await expect(auth.token()).rejects.toThrow("Google sign-in ran out");
});

test("with the relay, signing out drops the cookie there", async () => {
  const { auth, relay } = setup({ response: {} }, { relayUrl: RELAY });
  await auth.signIn();
  await auth.signOut();
  expect(relay.calls.at(-1)).toBe("DELETE /v1/auth/google");
  expect(relay.signedIn).toBe(false);
  await expect(auth.token()).rejects.toThrow("Not signed in to Google");
});
