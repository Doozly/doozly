import { createStore } from "zustand/vanilla";
import { type Clock, clock as deviceClock } from "../data/clock.ts";
import type { Snapshot } from "../data/db.ts";
import type { App, AppState } from "../state/store.ts";
import {
  BadFileError,
  decodeList,
  decodeManifest,
  decodeSettings,
  encode,
  listIdOf,
  listPath,
  MANIFEST_PATH,
  NewerSchemaError,
  SCHEMA_VERSION,
  SETTINGS_PATH,
} from "./files.ts";
import {
  canonical,
  changes,
  latestStamp,
  listFileFor,
  mergeSnapshots,
  prune,
  RETENTION_MS,
} from "./merge.ts";
import {
  AuthError,
  ConflictError,
  NoStorageError,
  ProviderError,
  type StorageProvider,
} from "./provider.ts";

export type SyncPhase =
  | "off"
  | "syncing"
  | "idle"
  /** Network or provider trouble, it tries again by itself */
  | "offline"
  /** Needs a new sign-in, then `resume()` */
  | "signedOut"
  /** A file came from a newer Doozly, this one must update before it syncs again */
  | "newerApp"
  /** A remote file is broken, we stop rather than write over it */
  | "error"
  /** The account has nowhere to keep files, like a work account without OneDrive */
  | "noStorage";

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncedAt: number | null;
  /** Files waiting to be pushed */
  pending: number;
  error: string | null;
}

interface EngineOptions {
  app: App;
  provider: StorageProvider;
  clock?: Clock;
  /** How often to look for changes while the tab is visible */
  pollMs?: number;
  /** Wait this long after a local change, so typing becomes one push */
  debounceMs?: number;
  now?: () => number;
  retention?: number;
}

const MAX_CONFLICT_RETRIES = 4;
const MAX_RETRY_MS = 5 * 60_000;

const emptySnapshot = (): Snapshot => ({
  lists: [],
  groups: [],
  tasks: [],
  steps: [],
  settings: [],
});

const snapshotOf = (s: AppState): Snapshot => ({
  lists: Object.values(s.lists),
  groups: Object.values(s.groups),
  tasks: Object.values(s.tasks),
  steps: Object.values(s.steps),
  settings: Object.values(s.settings),
});

const isOurFile = (path: string) =>
  path === MANIFEST_PATH || path === SETTINGS_PATH || listIdOf(path) !== null;

function decodeInto(path: string, data: Uint8Array): Snapshot {
  const s = emptySnapshot();
  if (path === MANIFEST_PATH) s.groups = decodeManifest(path, data).groups;
  else if (path === SETTINGS_PATH)
    s.settings = decodeSettings(path, data).settings;
  else {
    const f = decodeList(path, data);
    s.lists = [f.list];
    s.tasks = f.tasks;
    s.steps = f.steps;
  }
  return s;
}

const sameContent = (a: Uint8Array, b: Uint8Array) => {
  const text = (x: Uint8Array) => new TextDecoder().decode(x);
  try {
    return canonical(JSON.parse(text(a))) === canonical(JSON.parse(text(b)));
  } catch {
    return false;
  }
};

/**
 * Keeps the local store and the user's cloud folder in step. Local writes go
 * first, then get queued and pushed. Nothing here ever blocks the UI.
 */
export function createSyncEngine({
  app,
  provider,
  clock = deviceClock,
  pollMs = 45_000,
  debounceMs = 1_500,
  now = Date.now,
  retention = RETENTION_MS,
}: EngineOptions) {
  const status = createStore<SyncStatus>()(() => ({
    phase: "off",
    lastSyncedAt: null,
    pending: 0,
    error: null,
  }));
  const etags = new Map<string, string>();
  // Path to a change count, so a push only clears the changes it actually sent
  const dirty = new Map<string, number>();
  // Records we put in the store from remote, they mustn't get pushed straight back
  const fromRemote = new WeakSet<object>();
  let token: string | undefined;
  let reconciled = false;
  let blocked = false;
  let queue: Promise<void> = Promise.resolve();
  let scheduled: Promise<void> = Promise.resolve();
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 0;
  let teardown: (() => void)[] = [];

  let marks = 0;
  const markDirty = (path: string) => {
    marks++;
    dirty.set(path, (dirty.get(path) ?? 0) + 1);
    status.setState({ pending: dirty.size });
  };

  /** Turns store changes into files to push: local commits, undo, other tabs */
  function watch(next: AppState, prev: AppState) {
    const before = marks;
    const changed = <T extends object>(
      rows: Record<string, T>,
      old: Record<string, T>,
      onChange: (key: string, r: T) => void,
    ) => {
      if (rows === old) return;
      for (const [key, r] of Object.entries(rows)) {
        if (r !== old[key] && !fromRemote.has(r)) onChange(key, r);
      }
    };
    changed(next.lists, prev.lists, (id) => {
      markDirty(listPath(id));
      if (!prev.lists[id]) markDirty(MANIFEST_PATH);
    });
    changed(next.groups, prev.groups, () => markDirty(MANIFEST_PATH));
    changed(next.tasks, prev.tasks, (id, t) => {
      markDirty(listPath(t.listId));
      // Moved: the old list's file should let go of it too
      const old = prev.tasks[id];
      if (old && old.listId !== t.listId) markDirty(listPath(old.listId));
    });
    changed(next.steps, prev.steps, (_, st) => {
      const task = next.tasks[st.taskId];
      if (task) markDirty(listPath(task.listId));
    });
    changed(next.settings, prev.settings, () => markDirty(SETTINGS_PATH));
    if (marks !== before) pushSoon();
  }

  /** What a file should hold right now, null when it shouldn't exist any more */
  function contentFor(path: string): Uint8Array | null {
    // Merging with nothing sorts everything, so files come out the same on every device
    const s = prune(
      mergeSnapshots(snapshotOf(app.store.getState()), emptySnapshot()),
      now(),
      retention,
    );
    if (path === MANIFEST_PATH) {
      return encode({
        schema: SCHEMA_VERSION,
        groups: s.groups,
        listIds: s.lists.map((l) => l.id),
      });
    }
    if (path === SETTINGS_PATH) {
      return encode({ schema: SCHEMA_VERSION, settings: s.settings });
    }
    const list = s.lists.find((l) => l.id === listIdOf(path));
    return list ? encode(listFileFor(list, s)) : null;
  }

  /** Takes remote records into the store, where they're newer */
  function absorb(remote: Snapshot) {
    const latest = latestStamp(remote);
    if (latest) clock.receive(latest, now());
    const local = snapshotOf(app.store.getState());
    const batch = changes(local, mergeSnapshots(local, remote));
    for (const rows of Object.values(batch)) {
      for (const r of rows ?? []) fromRemote.add(r);
    }
    app.applyRemote(batch);
  }

  async function read(path: string) {
    const got = await provider.read(path);
    if (!got) {
      etags.delete(path);
      return null;
    }
    etags.set(path, got.etag);
    return { data: got.data, snapshot: decodeInto(path, got.data) };
  }

  /** Reads the files, takes them in, and queues the ones that are behind us */
  async function pullPaths(paths: string[]) {
    const remote = emptySnapshot();
    const seen: { path: string; data: Uint8Array }[] = [];
    for (const path of paths.filter(isOurFile)) {
      const got = await read(path);
      if (!got) continue;
      remote.lists.push(...got.snapshot.lists);
      remote.groups.push(...got.snapshot.groups);
      remote.tasks.push(...got.snapshot.tasks);
      remote.steps.push(...got.snapshot.steps);
      remote.settings.push(...got.snapshot.settings);
      seen.push({ path, data: got.data });
    }
    absorb(remote);
    for (const { path, data } of seen) {
      const ours = contentFor(path);
      if (!ours || !sameContent(ours, data)) markDirty(path);
    }
  }

  /** The first sync of a session: everything both ways. Also catches anything a closed tab left unpushed. */
  async function reconcile() {
    const feed = await provider.changesSince();
    await pullPaths(feed.changed);
    const remote = new Set(feed.changed);
    const s = prune(snapshotOf(app.store.getState()), now(), retention);
    for (const path of [
      MANIFEST_PATH,
      SETTINGS_PATH,
      ...s.lists.map((l) => listPath(l.id)),
    ]) {
      if (!remote.has(path)) markDirty(path);
    }
    token = feed.token;
    reconciled = true;
  }

  async function pull() {
    const feed = await provider.changesSince(token);
    await pullPaths(feed.changed);
    token = feed.token;
  }

  async function pushOne(path: string, attempt = 0): Promise<void> {
    const data = contentFor(path);
    try {
      if (data === null) {
        await provider.delete(path);
        etags.delete(path);
        return;
      }
      const { etag } = await provider.write(
        path,
        data,
        etags.get(path) ?? null,
      );
      etags.set(path, etag);
    } catch (err) {
      if (!(err instanceof ConflictError) || attempt >= MAX_CONFLICT_RETRIES) {
        throw err;
      }
      // Somebody wrote it since we looked: take theirs in, then send the merge
      const got = await read(path);
      if (got) absorb(got.snapshot);
      return pushOne(path, attempt + 1);
    }
  }

  async function pushAll() {
    for (const [path, version] of [...dirty]) {
      await pushOne(path);
      if (dirty.get(path) === version) dirty.delete(path);
      status.setState({ pending: dirty.size });
    }
  }

  function fail(err: unknown) {
    if (err instanceof NewerSchemaError) {
      blocked = true;
      status.setState({ phase: "newerApp", error: err.message });
    } else if (err instanceof AuthError) {
      blocked = true;
      status.setState({ phase: "signedOut", error: err.message });
    } else if (err instanceof NoStorageError) {
      blocked = true;
      status.setState({ phase: "noStorage", error: err.message });
    } else if (err instanceof BadFileError) {
      blocked = true;
      status.setState({ phase: "error", error: err.message });
    } else {
      // A change token the provider forgot means starting over with a full sync
      if (err instanceof ProviderError && !err.retryable) reconciled = false;
      status.setState({ phase: "offline", error: String(err) });
      retryDelay = Math.min(Math.max(retryDelay * 2, 5_000), MAX_RETRY_MS);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void syncNow(), retryDelay);
    }
  }

  /** One job at a time, pulls and pushes never overlap */
  function run(job: () => Promise<void>): Promise<void> {
    const next = queue.then(async () => {
      if (blocked) return;
      status.setState({ phase: "syncing" });
      try {
        await job();
        retryDelay = 0;
        clearTimeout(retryTimer);
        status.setState({
          phase: "idle",
          lastSyncedAt: now(),
          pending: dirty.size,
          error: null,
        });
      } catch (err) {
        fail(err);
      }
    });
    queue = next;
    return next;
  }

  function syncNow(): Promise<void> {
    return run(async () => {
      if (reconciled) await pull();
      else await reconcile();
      await pushAll();
    });
  }

  function pushSoon() {
    clearTimeout(pushTimer);
    scheduled = new Promise((resolve) => {
      pushTimer = setTimeout(() => {
        pushTimer = undefined;
        const job = reconciled ? run(pushAll) : syncNow();
        void job.then(resolve);
      }, debounceMs);
    });
  }

  function on(target: EventTarget, event: string, handler: () => void) {
    target.addEventListener(event, handler);
    teardown.push(() => target.removeEventListener(event, handler));
  }

  return {
    status,
    syncNow,

    /** Watches the store, listens for focus, online and visibility, polls, and syncs once */
    start(): Promise<void> {
      if (teardown.length) return queue;
      teardown.push(app.store.subscribe(watch));
      if (typeof window !== "undefined") {
        on(window, "focus", () => void syncNow());
        on(window, "online", () => void syncNow());
        on(document, "visibilitychange", () => {
          if (document.visibilityState === "visible") void syncNow();
        });
        const poll = setInterval(() => {
          if (document.visibilityState === "visible") void syncNow();
        }, pollMs);
        teardown.push(() => clearInterval(poll));
      }
      return syncNow();
    },

    stop() {
      for (const t of teardown) t();
      teardown = [];
      clearTimeout(pushTimer);
      clearTimeout(retryTimer);
      status.setState({ phase: "off" });
    },

    /** After signing in again, or updating the app */
    resume(): Promise<void> {
      blocked = false;
      return syncNow();
    },

    /** Resolves once nothing is waiting or running, for tests and for closing the tab */
    async settled() {
      let seen: Promise<void> | undefined;
      while (seen !== queue || pushTimer !== undefined) {
        seen = queue;
        await scheduled;
        await queue;
      }
    },
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
