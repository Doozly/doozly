import { DRIVE_API, DRIVE_UPLOAD, type DriveFile } from "./driveProvider.ts";

interface Stored extends DriveFile {
  data: Uint8Array;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const error = (status: number, reason: string) =>
  json(
    { error: { code: status, message: reason, errors: [{ reason }] } },
    status,
  );

function bodyBytes(body: BodyInit | null | undefined): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  throw new Error("The fake only takes bytes or text");
}

/** Pulls the metadata and the content out of a multipart/related upload */
function multipart(contentType: string, raw: Uint8Array) {
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) throw new Error("multipart without boundary");
  const text = new TextDecoder().decode(raw);
  const parts = text
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((p) => p.slice(p.indexOf("\r\n\r\n") + 4, -2));
  return {
    meta: JSON.parse(parts[0] ?? "{}") as { name: string; parents?: string[] },
    data: new TextEncoder().encode(parts[1] ?? ""),
  };
}

/** Drive v3's appDataFolder in memory, as a fetch. Only what the provider uses. */
export function createFakeDrive({ pageSize = 1000 } = {}) {
  const files = new Map<string, Stored>();
  const log: { fileId: string; removed: boolean }[] = [];
  const injected: Response[] = [];
  const hooks: { method: string; run: () => void }[] = [];
  const requests: { method: string; url: string }[] = [];
  let ids = 0;
  let clock = Date.UTC(2026, 0, 1);
  let revoked = false;

  const stamp = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };
  const meta = ({ data: _, ...f }: Stored): DriveFile => f;

  function put(name: string, data: Uint8Array, id?: string) {
    const old = id ? files.get(id) : undefined;
    const f: Stored = old
      ? {
          ...old,
          data,
          version: String(Number(old.version) + 1),
          size: String(data.length),
        }
      : {
          id: `f${++ids}`,
          name,
          version: "1",
          size: String(data.length),
          createdTime: stamp(),
          data,
        };
    files.set(f.id, f);
    log.push({ fileId: f.id, removed: false });
    return f;
  }

  function drop(id: string) {
    if (files.delete(id)) log.push({ fileId: id, removed: true });
  }

  function page<T>(items: T[], from: string | null) {
    const at = from ? Number(from) : 0;
    const next = at + pageSize;
    return {
      items: items.slice(at, next),
      nextPageToken: next < items.length ? String(next) : undefined,
    };
  }

  async function handle(url: URL, init: RequestInit): Promise<Response> {
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers).get("Authorization");
    if (revoked || auth !== "Bearer token") return error(401, "authError");
    const path = url.href.split("?")[0] ?? "";
    const q = url.searchParams;

    if (path === `${DRIVE_API}/files` && method === "GET") {
      if (q.get("spaces") !== "appDataFolder") return error(400, "badSpaces");
      const nameQuery = q.get("q")?.match(/^name = '((?:[^'\\]|\\.)*)'$/);
      const wanted = nameQuery?.[1]?.replace(/\\(.)/g, "$1");
      const all = [...files.values()]
        .filter((f) => wanted === undefined || f.name === wanted)
        .map(meta);
      const { items, nextPageToken } = page(all, q.get("pageToken"));
      return json({ files: items, nextPageToken });
    }

    const one = path.match(/\/files\/([^/]+)$/);
    const id = one?.[1];
    if (id && path.startsWith(DRIVE_API)) {
      const f = files.get(id);
      if (!f) return error(404, "notFound");
      if (method === "DELETE") {
        drop(id);
        return new Response(null, { status: 204 });
      }
      if (q.get("alt") === "media") return new Response(f.data.slice());
      return json(meta(f));
    }

    if (id && path.startsWith(DRIVE_UPLOAD) && method === "PATCH") {
      const f = files.get(id);
      if (!f) return error(404, "notFound");
      return json(meta(put(f.name, bodyBytes(init.body).slice(), id)));
    }

    if (path === `${DRIVE_UPLOAD}/files` && method === "POST") {
      const type = new Headers(init.headers).get("Content-Type") ?? "";
      const { meta: m, data } = multipart(type, bodyBytes(init.body));
      if (!m.parents?.includes("appDataFolder")) return error(400, "noParent");
      return json(meta(put(m.name, data)));
    }

    if (path === `${DRIVE_API}/changes/startPageToken`) {
      return json({ startPageToken: String(log.length) });
    }

    if (path === `${DRIVE_API}/changes`) {
      const from = Number(q.get("pageToken"));
      if (!Number.isInteger(from) || from < 0 || from > log.length) {
        return error(400, "invalid");
      }
      const rest = log.slice(from).map((c) => ({
        fileId: c.fileId,
        removed: c.removed,
        file: c.removed ? undefined : { name: files.get(c.fileId)?.name },
      }));
      const items = rest.slice(0, pageSize);
      const end = from + items.length;
      return json(
        end < log.length
          ? { changes: items, nextPageToken: String(end) }
          : { changes: items, newStartPageToken: String(log.length) },
      );
    }

    return error(404, `no route for ${method} ${path}`);
  }

  const fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    requests.push({ method, url: url.href });
    await Promise.resolve();
    const hook = hooks.findIndex((h) => h.method === method);
    if (hook >= 0) hooks.splice(hook, 1)[0]?.run();
    const next = injected.shift();
    if (next) return next;
    return handle(url, init);
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    token: async () => "token",
    requests,
    /** Signs the user out on Google's side, every call gets a 401 */
    revoke() {
      revoked = true;
    },
    /** The next request gets this answer, whatever it asked */
    respondNext(status: number, reason = "backendError") {
      injected.push(error(status, reason));
    },
    /** Runs `run` just before the next request with this method, to squeeze another device in */
    beforeNext(method: string, run: () => void) {
      hooks.push({ method, run });
    },
    /** What another device does, no checks */
    external: {
      write(name: string, data: Uint8Array) {
        const same = [...files.values()].find((f) => f.name === name);
        return put(name, data, same?.id).id;
      },
      /** A second file with a name that's taken, like two devices creating at once */
      duplicate(name: string, data: Uint8Array, olderThanAll = false) {
        const f = put(name, data);
        if (olderThanAll) f.createdTime = "2000-01-01T00:00:00.000Z";
        return f.id;
      },
      delete(id: string) {
        drop(id);
      },
    },
    named: (name: string) =>
      [...files.values()].filter((f) => f.name === name).map(meta),
    text: (id: string) => new TextDecoder().decode(files.get(id)?.data),
  };
}
