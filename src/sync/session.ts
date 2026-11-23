import { createStore } from "zustand/vanilla";
import { INBOX_ID } from "../data/model.ts";
import type { App } from "../state/store.ts";
import { createDropboxProvider } from "./dropbox/dropboxProvider.ts";
import {
  createSyncEngine,
  type SyncEngine,
  type SyncStatus,
} from "./engine.ts";
import { createDriveProvider } from "./google/driveProvider.ts";
import { createOneDriveProvider } from "./microsoft/oneDriveProvider.ts";
import {
  NoStorageError,
  SignInError,
  type StorageProvider,
} from "./provider.ts";

export type ProviderKind = "google" | "microsoft" | "dropbox";

export interface Account {
  provider: ProviderKind;
  id: string;
  email: string;
  name: string;
  /** Microsoft work or school account */
  work?: boolean;
}

type Profile = Omit<Account, "provider">;

/** What the session needs from a provider's sign-in */
export interface AccountAuth {
  signIn(): Promise<Profile>;
  token(): Promise<string>;
  signOut(): Promise<void>;
  /** An account from an earlier visit, if the library keeps one */
  restore?(): Promise<Profile | null>;
  /** The provider got a 401, don't hand that token out again */
  expire?(): void;
  /** Loads the library ahead, so a later popup still counts as part of the click */
  preload?(): Promise<unknown>;
  /** Gets a relay session for this account, without a popup. true when that worked. */
  relaySession?(): Promise<boolean>;
}

export interface SessionState {
  account: Account | null;
  /** This tab's sync, null when it isn't the one syncing */
  sync: SyncStatus | null;
  /** Another tab is doing the syncing for this browser */
  elsewhere: boolean;
  signingIn: ProviderKind | null;
}

interface SessionOptions {
  app: App;
  auths: Partial<Record<ProviderKind, AccountAuth>>;
  storage?: Storage | null;
  locks?: LockManager | null;
  makeProvider?: (kind: ProviderKind, auth: AccountAuth) => StorageProvider;
  makeEngine?: (app: App, provider: StorageProvider) => SyncEngine;
}

const ACCOUNT_KEY = "doozly.account";
// Whose data is on this device, it stays after signing out
const OWNER_KEY = "doozly.dataOwner";
const LOCK = "doozly-sync";

const ownerOf = (a: Account) => `${a.provider}:${a.id}`;

function defaultProvider(kind: ProviderKind, auth: AccountAuth) {
  const options = { token: auth.token, onUnauthorized: auth.expire };
  if (kind === "google") return createDriveProvider(options);
  if (kind === "dropbox") return createDropboxProvider(options);
  return createOneDriveProvider(options);
}

/** Anything the user made here, beyond the empty Tasks list every device has */
function hasData(app: App) {
  const s = app.store.getState();
  return (
    Object.values(s.tasks).some((t) => t.deletedAt === null) ||
    Object.values(s.lists).some(
      (l) => l.deletedAt === null && l.id !== INBOX_ID,
    )
  );
}

/**
 * Who's signed in, and the sync engine for them. Only one tab syncs at a time
 * (a Web Lock); the others get the changes through IndexedDB and the broadcast.
 */
export function createSession({
  app,
  auths,
  storage = typeof localStorage === "undefined" ? null : localStorage,
  locks = typeof navigator === "undefined" ? null : (navigator.locks ?? null),
  makeProvider = defaultProvider,
  makeEngine = (a, provider) => createSyncEngine({ app: a, provider }),
}: SessionOptions) {
  const state = createStore<SessionState>()(() => ({
    account: null,
    sync: null,
    elsewhere: false,
    signingIn: null,
  }));

  let engine: SyncEngine | null = null;
  let unwatch: (() => void) | null = null;
  let giveUp: AbortController | null = null;
  let release: (() => void) | null = null;

  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string | null) => {
    try {
      if (value === null) storage?.removeItem(key);
      else storage?.setItem(key, value);
    } catch {
      // Private mode or full: the account just won't be remembered
    }
  };

  function savedAccount(): Account | null {
    try {
      const a = JSON.parse(read(ACCOUNT_KEY) ?? "null") as Account | null;
      return a && auths[a.provider] ? a : null;
    } catch {
      return null;
    }
  }

  function stopSync() {
    giveUp?.abort();
    giveUp = null;
    unwatch?.();
    unwatch = null;
    engine?.stop();
    engine = null;
    release?.();
    release = null;
    state.setState({ sync: null, elsewhere: false });
  }

  function runEngine(account: Account) {
    const auth = auths[account.provider];
    if (!auth) return;
    engine = makeEngine(app, makeProvider(account.provider, auth));
    const current = engine;
    state.setState({ sync: current.status.getState(), elsewhere: false });
    unwatch = current.status.subscribe((sync) => state.setState({ sync }));
    void current.start();
  }

  /** Waits for the lock, or takes it from another tab when this one just signed in */
  function startSync(account: Account, steal: boolean) {
    stopSync();
    if (!locks) {
      runEngine(account);
      return;
    }
    const mine = new AbortController();
    giveUp = mine;
    state.setState({ elsewhere: true });
    locks
      .request(LOCK, steal ? { steal: true } : { signal: mine.signal }, () => {
        if (mine.signal.aborted) return;
        runEngine(account);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => {
        // We let go ourselves, nothing more to do
        if (mine.signal.aborted) return;
        // Another tab took over: stand by, and take it back when that tab closes
        const current = state.getState().account;
        if (current) startSync(current, false);
      });
  }

  function onStorage(e: StorageEvent) {
    if (e.key !== ACCOUNT_KEY) return;
    const next = savedAccount();
    const now = state.getState().account;
    if (next && now && ownerOf(next) === ownerOf(now)) return;
    stopSync();
    state.setState({ account: next });
    // Microsoft's tokens are shared between tabs, so this tab can stand by. Google's and Dropbox's aren't.
    if (next?.provider === "microsoft") startSync(next, false);
  }

  return {
    state,
    /** The sign-ins that are set up, in the order to offer them. Microsoft first, most people come from To Do. */
    providers: (["microsoft", "google", "dropbox"] as const).filter(
      (k) => auths[k],
    ),

    /** Picks up the account from last time and starts syncing if it can */
    async start() {
      if (typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
      }
      const saved = savedAccount();
      if (!saved) return;
      state.setState({ account: saved });
      const auth = auths[saved.provider];
      if (auth?.restore) {
        // Can't reach the provider or relay: sync anyway, the engine waits and retries
        const restored = await auth.restore().catch(() => undefined);
        if (restored === null || (restored && restored.id !== saved.id)) {
          state.setState({
            sync: {
              phase: "signedOut",
              lastSyncedAt: null,
              pending: 0,
              error: null,
              direction: null,
              done: 0,
              total: 0,
            },
          });
          return;
        }
      }
      // Without a relay Google's and Dropbox's token went with the last page. The engine then asks for a sign-in, unless another tab syncs.
      startSync(saved, false);
    },

    /** Opens the popup, so call it from a click. `confirmMerge` asks before another account's tasks go along. */
    async signIn(
      kind: ProviderKind,
      confirmMerge: (account: Account) => Promise<boolean> = async () => true,
    ): Promise<Account | null> {
      const auth = auths[kind];
      if (!auth) throw new Error(`No ${kind} sign-in set up`);
      state.setState({ signingIn: kind });
      try {
        const profile = await auth.signIn();
        const account: Account = { provider: kind, ...profile };
        // Better to say it now than to sync into nothing, like with a work account without OneDrive
        try {
          await makeProvider(kind, auth).list();
        } catch (err) {
          if (err instanceof NoStorageError) {
            await auth.signOut();
            throw new SignInError("noDriveAccess", err.message);
          }
          // Anything else, like a dropped connection, the sync deals with
        }
        const owner = read(OWNER_KEY);
        const current = state.getState().account;
        const same = current && ownerOf(current) === ownerOf(account);
        if (
          !same &&
          owner &&
          owner !== ownerOf(account) &&
          hasData(app) &&
          !(await confirmMerge(account))
        ) {
          await auth.signOut();
          return null;
        }
        write(ACCOUNT_KEY, JSON.stringify(account));
        write(OWNER_KEY, ownerOf(account));
        state.setState({ account });
        // Same account and this tab already syncs: just carry on with the new token
        if (same && engine) void engine.resume();
        else startSync(account, true);
        return account;
      } finally {
        state.setState({ signingIn: null });
      }
    },

    async signOut() {
      const account = state.getState().account;
      stopSync();
      state.setState({ account: null });
      write(ACCOUNT_KEY, null);
      if (account) await auths[account.provider]?.signOut();
    },

    /** Gets the sign-in libraries ready, like when the account menu opens */
    prepare() {
      for (const auth of Object.values(auths))
        void auth.preload?.().catch(() => {});
    },

    syncNow: () => engine?.syncNow() ?? Promise.resolve(),

    /** A relay session for whoever is signed in, for when the relay answered 401 */
    async renewRelay(): Promise<boolean> {
      const account = state.getState().account;
      const auth = account && auths[account.provider];
      return (await auth?.relaySession?.().catch(() => false)) ?? false;
    },

    /** Waits for this tab's sync to finish what it's doing, for tests */
    settled: () => engine?.settled() ?? Promise.resolve(),

    dispose() {
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
      stopSync();
    },
  };
}

export type Session = ReturnType<typeof createSession>;
