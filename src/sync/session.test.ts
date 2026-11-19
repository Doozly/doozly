import { afterEach, expect, test, vi } from "vitest";
import { INBOX_ID } from "../data/model.ts";
import { testApp } from "../test/app.ts";
import { createSyncEngine } from "./engine.ts";
import { createMemoryProvider, type MemoryProvider } from "./memoryProvider.ts";
import {
  AuthError,
  NoStorageError,
  SignInError,
  type StorageProvider,
} from "./provider.ts";
import { type AccountAuth, createSession, type Session } from "./session.ts";

const sessions: Session[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
});

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

/** A Web Lock with queueing, abort and steal, like the browser's */
function fakeLocks(): LockManager {
  type Holder = { stolen: (e: Error) => void };
  let holder: Holder | null = null;
  const queue: (() => void)[] = [];
  const next = () => {
    if (!holder) queue.shift()?.();
  };
  const request = (
    _name: string,
    options: LockOptions,
    callback: LockGrantedCallback<unknown>,
  ) =>
    new Promise((resolve, reject) => {
      const grant = () => {
        const me: Holder = { stolen: reject };
        holder = me;
        void Promise.resolve(callback(null)).then((v) => {
          if (holder !== me) return;
          holder = null;
          resolve(v);
          next();
        });
      };
      if (options.steal) {
        holder?.stolen(new DOMException("Lock stolen", "AbortError"));
        holder = null;
        grant();
      } else if (!holder) grant();
      else {
        queue.push(grant);
        options.signal?.addEventListener("abort", () => {
          queue.splice(queue.indexOf(grant), 1);
          reject(new DOMException("Aborted", "AbortError"));
        });
      }
    });
  return { request, query: vi.fn() } as unknown as LockManager;
}

function fakeAuth(id = "1", email = "sam@example.com") {
  let signedIn = false;
  return {
    signIn: vi.fn(async () => {
      signedIn = true;
      return { id, email, name: "Sam" };
    }),
    token: async () => {
      if (!signedIn) throw new AuthError();
      return "t";
    },
    signOut: vi.fn(async () => {
      signedIn = false;
    }),
  } satisfies AccountAuth;
}

/** The memory provider, but it wants a token like the real ones */
function gated(cloud: MemoryProvider, auth: AccountAuth): StorageProvider {
  const p = cloud.provider;
  const after =
    <A extends unknown[], R>(f: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      await auth.token();
      return f(...args);
    };
  return {
    read: after(p.read),
    write: after(p.write),
    delete: after(p.delete),
    list: after(p.list),
    changesSince: after(p.changesSince),
  };
}

async function tab(options: {
  cloud: MemoryProvider;
  auths: Record<string, AccountAuth>;
  storage: Storage;
  locks?: LockManager | null;
  channel?: string;
}) {
  const { app, actions, state } = await testApp(options.channel);
  const session = createSession({
    app,
    auths: options.auths,
    storage: options.storage,
    locks: options.locks ?? null,
    makeProvider: (_, auth) => gated(options.cloud, auth),
    makeEngine: (a, provider) =>
      createSyncEngine({ app: a, provider, debounceMs: 0 }),
  });
  sessions.push(session);
  const settle = async () => {
    await session.settled();
    await app.flush();
  };
  return { app, actions, state, session, settle, s: session.state.getState };
}

test("signed out, nothing syncs and the app works as ever", async () => {
  const cloud = createMemoryProvider();
  const t = await tab({
    cloud,
    auths: { google: fakeAuth() },
    storage: fakeStorage(),
  });
  await t.session.start();
  expect(t.s()).toMatchObject({ account: null, sync: null });
  t.actions.addTask(INBOX_ID, "Milk");
  await t.settle();
  expect(cloud.paths()).toEqual([]);
});

test("signing in remembers the account and syncs, signing out stops it", async () => {
  const cloud = createMemoryProvider();
  const storage = fakeStorage();
  const google = fakeAuth();
  const t = await tab({ cloud, auths: { google }, storage });
  await t.session.start();
  t.actions.addTask(INBOX_ID, "Milk");

  const account = await t.session.signIn("google");
  expect(account).toEqual({
    provider: "google",
    id: "1",
    email: "sam@example.com",
    name: "Sam",
  });
  await t.settle();
  expect(t.s().sync?.phase).toBe("idle");
  expect(cloud.paths()).toContain("lists/inbox.json");
  expect(JSON.parse(storage.getItem("doozly.account") ?? "")).toEqual(account);

  await t.session.signOut();
  expect(t.s()).toMatchObject({ account: null, sync: null });
  expect(google.signOut).toHaveBeenCalled();
  expect(storage.getItem("doozly.account")).toBeNull();
  // The tasks stay on the device
  expect(Object.values(t.state().tasks).map((x) => x.title)).toEqual(["Milk"]);
});

test("after a reload, Google needs a sign-in again and says so", async () => {
  const cloud = createMemoryProvider();
  const storage = fakeStorage();
  const first = await tab({ cloud, auths: { google: fakeAuth() }, storage });
  await first.session.signIn("google");
  first.session.dispose();

  // A new page: same storage, but the token is gone
  const google = fakeAuth();
  const t = await tab({ cloud, auths: { google }, storage });
  await t.session.start();
  await t.settle();
  expect(t.s().account?.email).toBe("sam@example.com");
  expect(t.s().sync?.phase).toBe("signedOut");

  await t.session.signIn("google");
  await t.settle();
  expect(t.s().sync?.phase).toBe("idle");
});

test("an account the library still has syncs straight away", async () => {
  const cloud = createMemoryProvider();
  const storage = fakeStorage();
  storage.setItem(
    "doozly.account",
    JSON.stringify({
      provider: "microsoft",
      id: "m1",
      email: "sam@outlook.com",
      name: "Sam",
    }),
  );
  const microsoft = {
    ...fakeAuth("m1"),
    token: async () => "t",
    restore: vi.fn(async () => ({
      id: "m1",
      email: "sam@outlook.com",
      name: "Sam",
    })),
  };
  const t = await tab({ cloud, auths: { microsoft }, storage });
  await t.session.start();
  await t.settle();
  expect(t.s().sync?.phase).toBe("idle");
  expect(microsoft.signIn).not.toHaveBeenCalled();
});

test("when the relay can't be reached at start, sync goes ahead and retries", async () => {
  const cloud = createMemoryProvider();
  const storage = fakeStorage();
  storage.setItem(
    "doozly.account",
    JSON.stringify({
      provider: "google",
      id: "1",
      email: "sam@example.com",
      name: "Sam",
    }),
  );
  const google = {
    ...fakeAuth(),
    token: async () => "t",
    restore: vi.fn(async () => {
      throw new Error("relay down");
    }),
  };
  const t = await tab({ cloud, auths: { google }, storage });
  await t.session.start();
  await t.settle();
  expect(t.s().sync?.phase).toBe("idle");
});

test("another account's tasks only go along when the user says so", async () => {
  const cloud = createMemoryProvider();
  const storage = fakeStorage();
  const sam = fakeAuth("1", "sam@example.com");
  const t = await tab({ cloud, auths: { google: sam }, storage });
  await t.session.signIn("google");
  t.actions.addTask(INBOX_ID, "Milk");
  await t.settle();
  await t.session.signOut();

  const work = fakeAuth("2", "sam@work.com");
  const t2 = await tab({
    cloud: createMemoryProvider(),
    auths: { google: work },
    storage,
  });
  const confirm = vi.fn(async () => false);
  expect(await t2.session.signIn("google", confirm)).toBeNull();
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ email: "sam@work.com" }),
  );
  expect(work.signOut).toHaveBeenCalled();
  expect(t2.s().account).toBeNull();

  confirm.mockResolvedValueOnce(true);
  expect(await t2.session.signIn("google", confirm)).not.toBeNull();
});

test("the first sign-in, or the same account again, doesn't ask", async () => {
  const cloud = createMemoryProvider();
  const t = await tab({
    cloud,
    auths: { google: fakeAuth() },
    storage: fakeStorage(),
  });
  t.actions.addTask(INBOX_ID, "Milk");
  const confirm = vi.fn(async () => false);
  expect(await t.session.signIn("google", confirm)).not.toBeNull();
  await t.session.signOut();
  expect(await t.session.signIn("google", confirm)).not.toBeNull();
  expect(confirm).not.toHaveBeenCalled();
});

test("only one tab syncs, and the one signing in takes over", async () => {
  const cloud = createMemoryProvider();
  const storage = fakeStorage();
  const locks = fakeLocks();
  const a = await tab({
    cloud,
    auths: { google: fakeAuth() },
    storage,
    locks,
    channel: "x",
  });
  const b = await tab({
    cloud,
    auths: { google: fakeAuth() },
    storage,
    locks,
    channel: "x",
  });

  await a.session.signIn("google");
  await a.settle();
  expect(a.s()).toMatchObject({ elsewhere: false, sync: { phase: "idle" } });

  await b.session.start();
  expect(b.s()).toMatchObject({ elsewhere: true, sync: null });

  await b.session.signIn("google");
  await b.settle();
  await Promise.resolve();
  expect(b.s()).toMatchObject({ elsewhere: false, sync: { phase: "idle" } });
  expect(a.s()).toMatchObject({ elsewhere: true, sync: null });

  // b closes, a takes over again
  b.session.dispose();
  await vi.waitFor(() => expect(a.s().elsewhere).toBe(false));
});

test("an account with no storage can't sign in, and is told why", async () => {
  const microsoft = fakeAuth();
  const { app } = await testApp();
  const session = createSession({
    app,
    auths: { microsoft },
    storage: fakeStorage(),
    locks: null,
    makeProvider: () => ({
      ...createMemoryProvider().provider,
      list: async () => {
        throw new NoStorageError("This Microsoft account has no OneDrive");
      },
    }),
  });
  sessions.push(session);
  const err = await session.signIn("microsoft").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SignInError);
  expect(err).toMatchObject({
    reason: "noDriveAccess",
    message: "This Microsoft account has no OneDrive",
  });
  expect(microsoft.signOut).toHaveBeenCalled();
  expect(session.state.getState()).toMatchObject({ account: null, sync: null });
});
