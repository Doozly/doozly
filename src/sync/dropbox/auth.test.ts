// @vitest-environment node
import { expect, test, vi } from "vitest";
import { AuthError, ProviderError, SignInError } from "../provider.ts";
import {
  createDropboxAuth,
  DROPBOX_ACCOUNT,
  DROPBOX_REVOKE,
  DROPBOX_TOKEN,
  type Popup,
  WRITE_SCOPE,
} from "./auth.ts";
import type { PopupAnswer } from "./popup.ts";

const RELAY = "https://relay.test";
const ORIGIN = "https://doozly.test";
const GRANTED = `account_info.read files.content.read ${WRITE_SCOPE} openid`;

/** Dropbox's popup, already decided what the user will click */
function fakePopup(answer: Partial<PopupAnswer> | "blocked" | "closed" = {}) {
  const opened: string[] = [];
  let closed = 0;
  const popup: Popup = {
    open: () =>
      answer === "blocked"
        ? null
        : {
            go: (url) => opened.push(url),
            close: () => {
              closed++;
            },
          },
    answer: async (state) => {
      if (answer === "closed" || answer === "blocked") {
        throw new SignInError("cancelled", "Sign-in was cancelled");
      }
      return { state, code: "the-code", ...answer };
    },
  };
  return { popup, opened, closed: () => closed };
}

/** Dropbox's token and account endpoints, and the relay. `relay.signedIn` is whether its cookie is there. */
function fakeServers(scope = GRANTED) {
  const relay = { signedIn: false, down: false, calls: [] as string[] };
  const revoked: string[] = [];
  let refreshes = 0;
  const fetch = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const auth = new Headers(init.headers).get("Authorization");
      if (url === DROPBOX_ACCOUNT) {
        return Response.json({
          account_id: "dbid:42",
          email: "sam@example.com",
          name: { display_name: "Sam" },
        });
      }
      if (url === DROPBOX_REVOKE) {
        revoked.push(String(auth));
        return Response.json(null);
      }
      if (url === DROPBOX_TOKEN) {
        const form = new URLSearchParams(String(init.body));
        expect(form.get("client_id")).toBe("app-key");
        expect(form.get("redirect_uri")).toBe(`${ORIGIN}/redirect.html`);
        expect(form.get("code_verifier")).toMatch(/^[\w-]{43}$/);
        return Response.json({
          access_token: "tok",
          expires_in: 14400,
          scope,
        });
      }
      if (relay.down) throw new TypeError("Failed to fetch");
      const call = `${init.method ?? "GET"} ${url.replace(RELAY, "")}`;
      relay.calls.push(call);
      expect(init.credentials).toBe("include");
      switch (call) {
        case "POST /v1/auth/dropbox/token":
          expect(JSON.parse(String(init.body))).toEqual({
            code: "the-code",
            verifier: expect.stringMatching(/^[\w-]{43}$/),
            redirectUri: `${ORIGIN}/redirect.html`,
          });
          relay.signedIn = true;
          return Response.json({
            accessToken: "relay-tok",
            expiresIn: 14400,
            scope,
          });
        case "POST /v1/auth/dropbox/refresh":
          if (!relay.signedIn) return new Response(null, { status: 401 });
          refreshes++;
          return Response.json({
            accessToken: `fresh-${refreshes}`,
            expiresIn: 14400,
          });
        case "DELETE /v1/auth/dropbox":
          relay.signedIn = false;
          return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    },
  );
  return { fetch, relay, revoked };
}

function setup(
  answer?: Parameters<typeof fakePopup>[0],
  { relayUrl, scope }: { relayUrl?: string; scope?: string } = {},
) {
  const popup = fakePopup(answer);
  const servers = fakeServers(scope);
  let time = 1_000_000;
  const auth = createDropboxAuth({
    clientId: "app-key",
    relayUrl,
    popup: popup.popup,
    fetch: servers.fetch as typeof fetch,
    now: () => time,
    origin: ORIGIN,
  });
  return {
    auth,
    ...popup,
    ...servers,
    later: (ms: number) => {
      time += ms;
    },
  };
}

test("signing in alone gives the account and a 4 hour token, no refresh token", async () => {
  const { auth, opened, closed, later } = setup();
  await expect(auth.token()).rejects.toThrow(AuthError);
  expect(auth.restore).toBeUndefined();

  expect(await auth.signIn()).toEqual({
    id: "dbid:42",
    email: "sam@example.com",
    name: "Sam",
  });
  const url = new URL(opened[0] ?? "");
  expect(url.origin + url.pathname).toBe(
    "https://www.dropbox.com/oauth2/authorize",
  );
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toMatch(/^dropbox\./);
  expect(url.searchParams.get("token_access_type")).toBe("online");
  expect(url.searchParams.get("scope")).toContain(WRITE_SCOPE);
  expect(closed()).toBe(1);
  expect(await auth.token()).toBe("tok");

  later(238 * 60_000);
  expect(await auth.token()).toBe("tok");
  later(60_000);
  await expect(auth.token()).rejects.toThrow("Dropbox sign-in ran out");
});

test("with the relay the code goes there and the sign-in lasts", async () => {
  const { auth, relay, opened, later } = setup({}, { relayUrl: RELAY });
  await auth.signIn();
  expect(new URL(opened[0] ?? "").searchParams.get("token_access_type")).toBe(
    "offline",
  );
  expect(await auth.token()).toBe("relay-tok");
  later(240 * 60_000);
  expect(await auth.token()).toBe("fresh-1");
  expect(relay.calls).toEqual([
    "POST /v1/auth/dropbox/token",
    "POST /v1/auth/dropbox/refresh",
  ]);
  // Calls at the same time share one refresh
  later(240 * 60_000);
  expect(await Promise.all([auth.token(), auth.token()])).toEqual([
    "fresh-2",
    "fresh-2",
  ]);
});

test("restore picks up the relay's cookie, or says there's none", async () => {
  const { auth, relay } = setup({}, { relayUrl: RELAY });
  expect(await auth.restore?.()).toBeNull();
  relay.signedIn = true;
  expect(await auth.restore?.()).toMatchObject({ id: "dbid:42" });
  relay.down = true;
  await expect(auth.restore?.()).rejects.toThrow(ProviderError);
});

test("a cancel, a closed or blocked window, or no Drive access each say so", async () => {
  await expect(
    setup({ error: "access_denied" }).auth.signIn(),
  ).rejects.toMatchObject({ reason: "cancelled" });
  const closed = setup("closed");
  await expect(closed.auth.signIn()).rejects.toMatchObject({
    reason: "cancelled",
  });
  expect(closed.closed()).toBe(1);
  await expect(setup("blocked").auth.signIn()).rejects.toMatchObject({
    reason: "failed",
  });
  await expect(
    setup({ error: "server_error", errorDescription: "Oops" }).auth.signIn(),
  ).rejects.toThrow("Oops");
  await expect(
    setup({}, { scope: "account_info.read" }).auth.signIn(),
  ).rejects.toMatchObject({ reason: "noDriveAccess" });
});

test("expire drops the token, sign-out revokes this grant and clears the relay", async () => {
  const { auth, relay, revoked } = setup({}, { relayUrl: RELAY });
  await auth.signIn();
  auth.expire();
  expect(await auth.token()).toBe("fresh-1");
  await auth.signOut();
  expect(revoked).toEqual(["Bearer fresh-1"]);
  expect(relay.calls.at(-1)).toBe("DELETE /v1/auth/dropbox");
  expect(auth.account()).toBeNull();
  await expect(auth.token()).rejects.toThrow(AuthError);
});
