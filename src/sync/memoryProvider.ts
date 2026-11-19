import {
  ConflictError,
  type FileInfo,
  ProviderError,
  type StorageProvider,
} from "./provider.ts";

type Op = "read" | "write" | "delete" | "list" | "changesSince";

/** A StorageProvider in memory, with ETags and a change feed like the real ones. Failures can be set up. */
export function createMemoryProvider() {
  const files = new Map<string, { data: Uint8Array; etag: string }>();
  // Every change in order. A token is how far into this log you've read.
  const log: string[] = [];
  let etags = 0;
  const failures: { op: Op; error: Error }[] = [];
  // Path to what "another device" writes there just before our next write
  const conflicts = new Map<string, Uint8Array | undefined>();
  const calls: Record<Op, number> = {
    read: 0,
    write: 0,
    delete: 0,
    list: 0,
    changesSince: 0,
  };

  const put = (path: string, data: Uint8Array) => {
    const etag = `"${++etags}"`;
    files.set(path, { data: data.slice(), etag });
    log.push(path);
    return etag;
  };

  const enter = async (op: Op) => {
    calls[op]++;
    // A real provider is never synchronous, so neither are we
    await Promise.resolve();
    const i = failures.findIndex((f) => f.op === op);
    if (i >= 0) {
      const [f] = failures.splice(i, 1);
      if (f) throw f.error;
    }
  };

  const provider: StorageProvider = {
    async read(path) {
      await enter("read");
      const f = files.get(path);
      return f ? { data: f.data.slice(), etag: f.etag } : null;
    },

    async write(path, data, ifMatch) {
      await enter("write");
      if (conflicts.has(path)) {
        // Another device got there first, just before us
        const theirs = conflicts.get(path);
        conflicts.delete(path);
        put(path, theirs ?? files.get(path)?.data ?? new Uint8Array());
      }
      const current = files.get(path);
      if (ifMatch === null && current) throw new ConflictError(path);
      if (typeof ifMatch === "string" && current?.etag !== ifMatch) {
        throw new ConflictError(path);
      }
      return { etag: put(path, data) };
    },

    async delete(path) {
      await enter("delete");
      if (files.delete(path)) log.push(path);
    },

    async list(): Promise<FileInfo[]> {
      await enter("list");
      return [...files.entries()]
        .map(([path, f]) => ({ path, etag: f.etag, size: f.data.length }))
        .sort((a, b) => (a.path < b.path ? -1 : 1));
    },

    async changesSince(token) {
      await enter("changesSince");
      const from = token === undefined ? null : Number(token);
      if (
        from !== null &&
        !(Number.isInteger(from) && from >= 0 && from <= log.length)
      ) {
        throw new ProviderError(`Unknown change token ${token}`, false);
      }
      const changed =
        from === null ? [...files.keys()] : [...new Set(log.slice(from))];
      return { changed: changed.sort(), token: String(log.length) };
    },
  };

  return {
    provider,
    /** How often each call was made */
    calls,
    /** Writes as another device would, no ETag check */
    external: {
      write: (path: string, data: Uint8Array) => put(path, data),
      delete: (path: string) => {
        if (files.delete(path)) log.push(path);
      },
    },
    /** The next call of this kind throws, like a dropped connection */
    failNext(op: Op, error: Error = new ProviderError(`${op} failed`)) {
      failures.push({ op, error });
    },
    /** The next write to this path finds someone else wrote it (with `data`, if given) just before */
    conflictNext(path: string, data?: Uint8Array) {
      conflicts.set(path, data);
    },
    paths: () => [...files.keys()].sort(),
  };
}

export type MemoryProvider = ReturnType<typeof createMemoryProvider>;
