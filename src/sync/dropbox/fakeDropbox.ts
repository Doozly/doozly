import {
  DROPBOX_API,
  DROPBOX_CONTENT,
  type DropboxEntry,
} from "./dropboxProvider.ts";

interface Stored {
  name: string;
  rev: string;
  data: Uint8Array;
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const conflict = (summary: string) =>
  json({ error_summary: `${summary}/..`, error: {} }, 409);

/** Dropbox's app folder endpoints in memory, as a fetch. Only what the provider uses. */
export function createFakeDropbox({ pageSize = 1000 } = {}) {
  // By lower-case path with its leading slash, like Dropbox's path_lower
  const files = new Map<string, Stored>();
  // Every change in order, the cursor is how far into it a client has seen
  const log: string[] = [];
  const injected: Response[] = [];
  let revs = 0;
  let revoked = false;

  const entry = (lower: string, f: Stored): DropboxEntry => ({
    ".tag": "file",
    name: f.name,
    path_lower: lower,
    rev: f.rev,
    size: f.data.length,
  });

  /** `path` like Dropbox has it, "/lists/a.json" */
  function put(path: string, data: Uint8Array) {
    const lower = path.toLowerCase();
    const f = {
      name: path.split("/").at(-1) ?? path,
      rev: `0${(++revs).toString(16)}0000000`,
      data,
    };
    files.set(lower, f);
    log.push(lower);
    return entry(lower, f);
  }

  function remove(path: string) {
    const lower = path.toLowerCase();
    if (!files.delete(lower)) return false;
    log.push(lower);
    return true;
  }

  function folders(): string[] {
    const out = new Set<string>();
    for (const lower of files.keys()) {
      const parent = lower.slice(0, lower.lastIndexOf("/"));
      if (parent) out.add(parent);
    }
    return [...out];
  }

  /** What changed since log position `from`: files as they are now, or deleted */
  function entriesSince(from: number | null): DropboxEntry[] {
    if (from === null) {
      return [
        ...folders().map(
          (lower): DropboxEntry => ({
            ".tag": "folder",
            name: lower.split("/").at(-1) ?? "",
            path_lower: lower,
          }),
        ),
        ...[...files].map(([lower, f]) => entry(lower, f)),
      ];
    }
    const touched = [...new Set(log.slice(from))];
    return touched.map((lower) => {
      const f = files.get(lower);
      return f
        ? entry(lower, f)
        : {
            ".tag": "deleted",
            name: lower.split("/").at(-1) ?? "",
            path_lower: lower,
          };
    });
  }

  // A cursor is "<log position>:<offset into that page>"; full listings start at "full"
  function page(all: DropboxEntry[], at: number, base: string) {
    const slice = all.slice(at, at + pageSize);
    const more = at + pageSize < all.length;
    return json({
      entries: slice,
      has_more: more,
      cursor: more ? `${base}:${at + pageSize}` : `${log.length}:0`,
    });
  }

  function handle(url: string, init: RequestInit): Response {
    const headers = new Headers(init.headers);
    if (revoked || headers.get("Authorization") !== "Bearer token") {
      return json({ error_summary: "invalid_access_token/.." }, 401);
    }
    const arg = (): Record<string, unknown> =>
      JSON.parse(
        url.startsWith(DROPBOX_CONTENT)
          ? (headers.get("Dropbox-API-Arg") ?? "{}")
          : String(init.body),
      ) as Record<string, unknown>;
    const path = () => String(arg().path);

    switch (url) {
      case `${DROPBOX_CONTENT}/files/download`: {
        const f = files.get(path().toLowerCase());
        if (!f) return conflict("path/not_found");
        return new Response(f.data.slice(), {
          headers: {
            "Dropbox-API-Result": JSON.stringify(
              entry(path().toLowerCase(), f),
            ),
          },
        });
      }
      case `${DROPBOX_CONTENT}/files/upload`: {
        const a = arg();
        const current = files.get(path().toLowerCase());
        const mode = a.mode as string | { ".tag": string; update: string };
        if (mode === "add" && current) return conflict("path/conflict/file");
        if (typeof mode === "object") {
          // strict_conflict: a rev on a file that's gone is a conflict as well
          if (!current && a.strict_conflict)
            return conflict("path/conflict/file");
          if (current && current.rev !== mode.update) {
            return conflict("path/conflict/file");
          }
        }
        const body: unknown = init.body;
        if (!(body instanceof Uint8Array)) {
          throw new Error("The fake only takes bytes");
        }
        return json(put(path(), body.slice()));
      }
      case `${DROPBOX_API}/files/delete_v2`:
        return remove(path())
          ? json({ metadata: {} })
          : conflict("path_lookup/not_found");
      case `${DROPBOX_API}/files/list_folder`:
        return page(entriesSince(null), 0, "full");
      case `${DROPBOX_API}/files/list_folder/continue`: {
        const [base = "", at = "0"] = String(arg().cursor).split(":");
        if (base === "full") return page(entriesSince(null), Number(at), base);
        const from = Number(base);
        if (!Number.isInteger(from) || from > log.length)
          return conflict("reset");
        return page(entriesSince(from), Number(at), base);
      }
    }
    return json({ error_summary: `no route for ${url}` }, 400);
  }

  const fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    await Promise.resolve();
    const next = injected.shift();
    if (next) return next;
    return handle(String(input), init);
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    token: async () => "token",
    revoke() {
      revoked = true;
    },
    respondNext(status: number, body: unknown = { error_summary: "oops/" }) {
      injected.push(json(body, status));
    },
    external: {
      write: (path: string, data: Uint8Array) => void put(`/${path}`, data),
      delete: (path: string) => void remove(`/${path}`),
    },
    paths: () => [...files.keys()].map((p) => p.slice(1)).sort(),
  };
}
