import {
  AuthError,
  ConflictError,
  type FileInfo,
  ProviderError,
  type StorageProvider,
} from "../provider.ts";

export const DROPBOX_API = "https://api.dropboxapi.com/2";
export const DROPBOX_CONTENT = "https://content.dropboxapi.com/2";

export interface DropboxEntry {
  ".tag": "file" | "folder" | "deleted";
  name: string;
  path_lower: string;
  rev?: string;
  size?: number;
}

interface ListResult {
  entries: DropboxEntry[];
  cursor: string;
  has_more: boolean;
}

interface DropboxOptions {
  /** A valid access token, or throws AuthError */
  token: () => Promise<string>;
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

/** Our "lists/a.json" is "/lists/a.json" in the app folder */
const dropboxPath = (path: string) => `/${path}`;

/** Back to our path. path_lower's folders are ours and lower case already, the name keeps its case. */
function pathOf(e: DropboxEntry): string {
  const parent = e.path_lower.slice(1, e.path_lower.lastIndexOf("/"));
  return parent ? `${parent}/${e.name}` : e.name;
}

/** Dropbox-API-Arg is a header, so anything past ASCII goes in as \uXXXX */
export const headerArg = (arg: unknown) =>
  JSON.stringify(arg).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

/** The app folder (Apps/Doozly) as a StorageProvider. The rev is the ETag, and upload's update mode checks it on the server. */
export function createDropboxProvider({
  token,
  onUnauthorized,
  fetch: fetchImpl = (...args) => fetch(...args),
}: DropboxOptions): StorageProvider {
  /** The error_summary of a 409, like "path/not_found/..", null when it's something else */
  async function summary(res: Response): Promise<string | null> {
    if (res.status !== 409) return null;
    try {
      const body = (await res.clone().json()) as { error_summary?: string };
      return body.error_summary ?? "";
    } catch {
      return "";
    }
  }

  async function failure(res: Response, what: string): Promise<Error> {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // Nothing to read, the status has to do
    }
    const message = `${what}: Dropbox answered ${res.status}${detail ? ` (${detail})` : ""}`;
    if (res.status === 401) {
      onUnauthorized?.();
      return new AuthError("Dropbox sign-in ran out");
    }
    if (res.status === 403) {
      return new AuthError("Doozly has no access to its Dropbox folder");
    }
    const retryable =
      res.status === 429 ||
      res.status >= 500 ||
      /insufficient_space/.test(detail);
    return new ProviderError(message, retryable);
  }

  /** Lets 409s through, each endpoint knows what its own mean */
  async function call(
    url: string,
    what: string,
    init: RequestInit,
  ): Promise<Response> {
    const bearer = await token();
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${bearer}` },
      });
    } catch (err) {
      throw new ProviderError(`${what}: ${String(err)}`);
    }
    if (res.ok || res.status === 409) return res;
    throw await failure(res, what);
  }

  async function rpc<T>(
    endpoint: string,
    what: string,
    arg: unknown,
  ): Promise<{ result: T } | { conflict: string }> {
    const res = await call(`${DROPBOX_API}${endpoint}`, what, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(arg),
    });
    const conflict = await summary(res);
    if (conflict !== null) return { conflict };
    return { result: (await res.json()) as T };
  }

  /** Every entry from list_folder or its continue, until has_more is off */
  async function listAll(
    first: { result: ListResult } | { conflict: string },
    what: string,
  ): Promise<{ entries: DropboxEntry[]; cursor: string }> {
    const entries: DropboxEntry[] = [];
    let page = first;
    for (;;) {
      if ("conflict" in page) {
        // A reset cursor or a folder we can't read: start over with a full listing
        throw new ProviderError(`${what}: ${page.conflict}`, false);
      }
      entries.push(...page.result.entries);
      if (!page.result.has_more) return { entries, cursor: page.result.cursor };
      page = await rpc<ListResult>("/files/list_folder/continue", what, {
        cursor: page.result.cursor,
      });
    }
  }

  const everything = () =>
    rpc<ListResult>("/files/list_folder", "list the folder", {
      path: "",
      recursive: true,
    }).then((first) => listAll(first, "list the folder"));

  return {
    async read(path) {
      const res = await call(
        `${DROPBOX_CONTENT}/files/download`,
        `read ${path}`,
        {
          headers: {
            "Dropbox-API-Arg": headerArg({ path: dropboxPath(path) }),
          },
        },
      );
      const conflict = await summary(res);
      if (conflict !== null) {
        if (conflict.startsWith("path/not_found")) return null;
        throw new ProviderError(`read ${path}: ${conflict}`, false);
      }
      const meta = JSON.parse(
        res.headers.get("Dropbox-API-Result") ?? "{}",
      ) as Partial<DropboxEntry>;
      if (!meta.rev) throw new ProviderError(`read ${path}: no rev`);
      return { data: new Uint8Array(await res.arrayBuffer()), etag: meta.rev };
    },

    async write(path, data, ifMatch) {
      const mode =
        ifMatch === null
          ? "add"
          : typeof ifMatch === "string"
            ? { ".tag": "update", update: ifMatch }
            : "overwrite";
      const res = await call(
        `${DROPBOX_CONTENT}/files/upload`,
        `write ${path}`,
        {
          headers: {
            "Content-Type": "application/octet-stream",
            // strict_conflict: a rev of a deleted file is a conflict too, not a quiet new file
            "Dropbox-API-Arg": headerArg({
              path: dropboxPath(path),
              mode,
              autorename: false,
              mute: true,
              strict_conflict: true,
            }),
          },
          body: new Uint8Array(data),
        },
      );
      const conflict = await summary(res);
      if (conflict !== null) {
        if (/^path\/conflict/.test(conflict)) throw new ConflictError(path);
        throw new ProviderError(
          `write ${path}: ${conflict}`,
          /insufficient_space/.test(conflict),
        );
      }
      return { etag: ((await res.json()) as DropboxEntry).rev ?? "" };
    },

    async delete(path) {
      const done = await rpc("/files/delete_v2", `delete ${path}`, {
        path: dropboxPath(path),
      });
      if ("conflict" in done && !/not_found/.test(done.conflict)) {
        throw new ProviderError(`delete ${path}: ${done.conflict}`);
      }
    },

    async list(): Promise<FileInfo[]> {
      const { entries } = await everything();
      return entries
        .filter((e) => e[".tag"] === "file")
        .map((e) => ({ path: pathOf(e), etag: e.rev ?? "", size: e.size ?? 0 }))
        .sort((a, b) => (a.path < b.path ? -1 : 1));
    },

    // Dropbox keeps the cursor, so a token from another device or day still works
    async changesSince(since) {
      const { entries, cursor } =
        since === undefined
          ? await everything()
          : await rpc<ListResult>(
              "/files/list_folder/continue",
              "look for changes",
              { cursor: since },
            ).then((first) => listAll(first, "look for changes"));
      const changed = new Set(
        entries.filter((e) => e[".tag"] !== "folder").map(pathOf),
      );
      return { changed: [...changed].sort(), token: cursor };
    },
  };
}
