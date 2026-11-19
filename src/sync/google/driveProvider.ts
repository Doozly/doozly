import {
  AuthError,
  ConflictError,
  type FileInfo,
  ProviderError,
  type StorageProvider,
} from "../provider.ts";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FILE_FIELDS = "id,name,version,size,createdTime";
const PAGE_SIZE = "1000";

export interface DriveFile {
  id: string;
  name: string;
  version: string;
  size?: string;
  createdTime: string;
}

interface DriveOptions {
  /** A valid access token, or throws AuthError */
  token: () => Promise<string>;
  /** Google turned the token down, so it shouldn't be handed out again */
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

// Drive v3 has no If-Match, so the "ETag" is the file's version. The id is in it
// too, so a file deleted and made again never matches an old one.
const etagOf = (f: DriveFile) => `${f.id}@${f.version}`;

/** Two devices can create the same name at once. Everybody takes the oldest, so all agree. */
function canonical(files: DriveFile[]): DriveFile | undefined {
  return files.toSorted(
    (a, b) =>
      a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id),
  )[0];
}

const quote = (s: string) => `'${s.replace(/[\\']/g, "\\$&")}'`;

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The Drive appDataFolder as a StorageProvider. It's flat, so "lists/abc.json" is simply the file name. */
export function createDriveProvider({
  token,
  onUnauthorized,
  fetch: fetchImpl = (...args) => fetch(...args),
}: DriveOptions): StorageProvider {
  // For removals in the change feed, which only carry the id
  const names = new Map<string, string>();

  async function failure(res: Response, what: string): Promise<Error> {
    let reason = "";
    let message = `${what}: Drive answered ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { message?: string; errors?: { reason?: string }[] };
      };
      reason = body.error?.errors?.[0]?.reason ?? "";
      if (body.error?.message) message += ` (${body.error.message})`;
    } catch {
      // No JSON in it, the status has to do
    }
    if (res.status === 401) {
      onUnauthorized?.();
      return new AuthError("Google sign-in ran out");
    }
    if (
      res.status === 403 &&
      /insufficient|appNotAuthorized|forbidden/i.test(reason)
    ) {
      return new AuthError("Doozly has no access to its Drive folder");
    }
    // Rate limits, a full Drive, Google having a bad day: all worth another go later
    const retryable =
      res.status === 403 || res.status === 429 || res.status >= 500;
    return new ProviderError(message, retryable);
  }

  /** Statuses in `pass` come back to the caller instead of throwing */
  async function call(
    url: string,
    what: string,
    init: RequestInit = {},
    pass: number[] = [],
  ): Promise<Response> {
    const bearer = await token();
    let res: Response;
    try {
      res = await fetchImpl(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${bearer}` },
      });
    } catch (err) {
      throw new ProviderError(`${what}: ${String(err)}`);
    }
    if (res.ok || pass.includes(res.status)) return res;
    throw await failure(res, what);
  }

  function remember(files: DriveFile[]) {
    for (const f of files) names.set(f.id, f.name);
    return files;
  }

  async function listFiles(q?: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        spaces: "appDataFolder",
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: PAGE_SIZE,
      });
      if (q) params.set("q", q);
      if (pageToken) params.set("pageToken", pageToken);
      const res = await call(`${DRIVE_API}/files?${params}`, "list files");
      const body = (await res.json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      files.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return remember(files);
  }

  const find = (path: string) => listFiles(`name = ${quote(path)}`);

  async function create(path: string, data: Uint8Array): Promise<DriveFile> {
    // Name and content in one go, so nobody ever reads a half-made, empty file
    const boundary = `doozly-${crypto.randomUUID()}`;
    const meta = JSON.stringify({
      name: path,
      parents: ["appDataFolder"],
      mimeType: "application/json",
    });
    const enc = new TextEncoder();
    const body = concat(
      enc.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      ),
      data,
      enc.encode(`\r\n--${boundary}--`),
    );
    const res = await call(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`,
      `create ${path}`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    return remember([(await res.json()) as DriveFile])[0] as DriveFile;
  }

  async function remove(id: string) {
    await call(
      `${DRIVE_API}/files/${id}`,
      "delete",
      { method: "DELETE" },
      [404],
    );
    names.delete(id);
  }

  async function startToken(): Promise<string> {
    const res = await call(
      `${DRIVE_API}/changes/startPageToken`,
      "start the change feed",
    );
    return ((await res.json()) as { startPageToken: string }).startPageToken;
  }

  const provider: StorageProvider = {
    async read(path) {
      const file = canonical(await find(path));
      if (!file) return null;
      const res = await call(
        `${DRIVE_API}/files/${file.id}?alt=media`,
        `read ${path}`,
        {},
        [404],
      );
      // Deleted between finding and reading it
      if (res.status === 404) return null;
      // The version is from before the download, so at worst it's older and the next write retries
      return {
        data: new Uint8Array(await res.arrayBuffer()),
        etag: etagOf(file),
      };
    },

    async write(path, data, ifMatch) {
      // Check, then upload. A write slipping in between gets lost here, but its device
      // still has the records and pushes them again after its next pull.
      const current = canonical(await find(path));
      if (ifMatch === null && current) throw new ConflictError(path);
      if (
        typeof ifMatch === "string" &&
        (!current || etagOf(current) !== ifMatch)
      ) {
        throw new ConflictError(path);
      }

      if (current) {
        const res = await call(
          `${DRIVE_UPLOAD}/files/${current.id}?uploadType=media&fields=${FILE_FIELDS}`,
          `write ${path}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: concat(data),
          },
          [404],
        );
        if (res.status === 404) throw new ConflictError(path);
        return { etag: etagOf(remember([await res.json()])[0] as DriveFile) };
      }

      const made = await create(path, data);
      // Did another device make the same file just now? Then the older one wins and ours goes.
      const winner = canonical(await find(path));
      if (winner && winner.id !== made.id) {
        await remove(made.id);
        throw new ConflictError(path);
      }
      return { etag: etagOf(made) };
    },

    async delete(path) {
      for (const f of await find(path)) await remove(f.id);
    },

    async list(): Promise<FileInfo[]> {
      const byName = new Map<string, DriveFile[]>();
      for (const f of await listFiles()) {
        byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
      }
      return [...byName.values()]
        .map((same) => canonical(same) as DriveFile)
        .map((f) => ({
          path: f.name,
          etag: etagOf(f),
          size: Number(f.size ?? 0),
        }))
        .sort((a, b) => (a.path < b.path ? -1 : 1));
    },

    async changesSince(since) {
      if (since === undefined) {
        // Token first, so a change made while we list isn't missed
        const next = await startToken();
        const all = await provider.list();
        return { changed: all.map((f) => f.path), token: next };
      }
      const changed = new Set<string>();
      let pageToken = since;
      for (;;) {
        const params = new URLSearchParams({
          pageToken,
          spaces: "appDataFolder",
          includeRemoved: "true",
          pageSize: PAGE_SIZE,
          fields:
            "nextPageToken,newStartPageToken,changes(fileId,removed,file(name))",
        });
        const res = await call(
          `${DRIVE_API}/changes?${params}`,
          "read the change feed",
          {},
          [400, 404, 410],
        );
        if (!res.ok) {
          // Drive forgot the token, so the engine starts over with a full sync
          throw new ProviderError(`Unknown change token ${since}`, false);
        }
        const body = (await res.json()) as {
          changes?: {
            fileId: string;
            removed?: boolean;
            file?: { name: string };
          }[];
          nextPageToken?: string;
          newStartPageToken?: string;
        };
        for (const c of body.changes ?? []) {
          const name = c.file?.name ?? names.get(c.fileId);
          if (c.file) names.set(c.fileId, c.file.name);
          if (c.removed) names.delete(c.fileId);
          if (name) changed.add(name);
        }
        if (body.newStartPageToken) {
          return {
            changed: [...changed].sort(),
            token: body.newStartPageToken,
          };
        }
        if (!body.nextPageToken) {
          throw new ProviderError("Drive's change feed ended without a token");
        }
        pageToken = body.nextPageToken;
      }
    },
  };

  return provider;
}
