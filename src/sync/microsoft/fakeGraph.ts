import { APP_ROOT, GRAPH_DRIVE, type GraphItem } from "./oneDriveProvider.ts";

const DOWNLOAD = "https://download.fake/";

interface Stored {
  id: string;
  version: number;
  data: Uint8Array;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const error = (status: number, code: string, message = code) =>
  json({ error: { code, message } }, status);

/** Graph's app folder endpoints in memory, as a fetch. Only what the provider uses. */
export function createFakeGraph({ pageSize = 999, autoParents = true } = {}) {
  const files = new Map<string, Stored>();
  const folders = new Set<string>();
  const injected: Response[] = [];
  const hooks: { method: string; run: () => void }[] = [];
  let ids = 0;
  let revoked = false;

  const eTag = (f: Stored) => `"{${f.id}},${f.version}"`;
  const item = (path: string, f: Stored): GraphItem => ({
    id: f.id,
    name: path.split("/").at(-1) ?? path,
    eTag: eTag(f),
    size: f.data.length,
    file: {},
  });

  function put(path: string, data: Uint8Array) {
    const old = files.get(path);
    const f = {
      id: old?.id ?? `i${++ids}`,
      version: (old?.version ?? 0) + 1,
      data,
    };
    files.set(path, f);
    return f;
  }

  function childrenOf(folder: string): GraphItem[] {
    const prefix = folder ? `${folder}/` : "";
    const out: GraphItem[] = [];
    if (!folder) {
      for (const name of folders) {
        out.push({ id: `folder-${name}`, name, eTag: `"${name}"`, folder: {} });
      }
    }
    for (const [path, f] of files) {
      const rest = path.slice(prefix.length);
      if (path.startsWith(prefix) && !rest.includes("/"))
        out.push(item(path, f));
    }
    return out;
  }

  function handle(url: URL, init: RequestInit): Response {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);

    if (url.href.startsWith(DOWNLOAD)) {
      const id = url.href.slice(DOWNLOAD.length);
      const found = [...files.values()].find((f) => f.id === id);
      return found
        ? new Response(found.data.slice())
        : error(404, "itemNotFound");
    }
    if (revoked || headers.get("Authorization") !== "Bearer token") {
      return error(401, "InvalidAuthenticationToken");
    }

    const byId = url.href.match(/\/items\/([^/]+)\/content$/);
    if (byId && url.href.startsWith(GRAPH_DRIVE)) {
      const found = [...files.values()].find((f) => f.id === byId[1]);
      return found
        ? new Response(found.data.slice())
        : error(404, "itemNotFound");
    }

    const rootPath = new URL(APP_ROOT).pathname;
    const m = url.pathname
      .slice(rootPath.length)
      .match(/^(?::\/(.+?):)?(\/children|\/content)?$/);
    if (!url.pathname.startsWith(rootPath) || !m) {
      return error(400, `no route for ${method} ${url.pathname}`);
    }
    const path = m[1]?.split("/").map(decodeURIComponent).join("/") ?? "";
    const tail = m[2] ?? "";

    if (tail === "/children" && method === "GET") {
      if (path && !folders.has(path)) return error(404, "itemNotFound");
      const all = childrenOf(path);
      const skip = Number(url.searchParams.get("$skiptoken") ?? 0);
      const page = all.slice(skip, skip + pageSize);
      const next = new URL(url);
      next.searchParams.set("$skiptoken", String(skip + pageSize));
      return json({
        value: page,
        "@odata.nextLink": skip + pageSize < all.length ? next.href : undefined,
      });
    }

    if (tail === "/children" && method === "POST" && !path) {
      const body = JSON.parse(String(init.body)) as { name: string };
      if (folders.has(body.name)) return error(409, "nameAlreadyExists");
      folders.add(body.name);
      return json(
        { id: `folder-${body.name}`, name: body.name, folder: {} },
        201,
      );
    }

    if (tail === "/content" && method === "PUT") {
      const current = files.get(path);
      const ifMatch = headers.get("If-Match");
      if (
        url.searchParams.get("@microsoft.graph.conflictBehavior") === "fail" &&
        current
      ) {
        return error(409, "nameAlreadyExists");
      }
      // Like the real Graph: If-Match on a file that's gone just makes it again
      if (ifMatch && current && eTag(current) !== ifMatch) {
        return error(412, "preconditionFailed");
      }
      const folder = path.includes("/") ? path.split("/")[0] : undefined;
      if (folder && !folders.has(folder)) {
        if (!autoParents) return error(404, "itemNotFound");
        folders.add(folder);
      }
      const body: unknown = init.body;
      if (!(body instanceof Uint8Array)) {
        throw new Error("The fake only takes bytes");
      }
      return json(item(path, put(path, body.slice())), current ? 200 : 201);
    }

    if (!tail && path) {
      const f = files.get(path);
      if (!f) return error(404, "itemNotFound");
      if (method === "DELETE") {
        files.delete(path);
        return new Response(null, { status: 204 });
      }
      return json({
        ...item(path, f),
        "@microsoft.graph.downloadUrl": `${DOWNLOAD}${f.id}`,
      });
    }

    return error(400, `no route for ${method} ${url.pathname}`);
  }

  const fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const method = init.method ?? "GET";
    await Promise.resolve();
    const hook = hooks.findIndex((h) => h.method === method);
    if (hook >= 0) hooks.splice(hook, 1)[0]?.run();
    const next = injected.shift();
    if (next) return next;
    return handle(new URL(String(input)), init);
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    token: async () => "token",
    revoke() {
      revoked = true;
    },
    respondNext(
      status: number,
      code = "serviceNotAvailable",
      message?: string,
    ) {
      injected.push(error(status, code, message));
    },
    /** Runs `run` just before the next request with this method, to squeeze another device in */
    beforeNext(method: string, run: () => void) {
      hooks.push({ method, run });
    },
    external: {
      write: (path: string, data: Uint8Array) => {
        const folder = path.includes("/") ? path.split("/")[0] : undefined;
        if (folder) folders.add(folder);
        put(path, data);
      },
      delete: (path: string) => files.delete(path),
    },
    folders: () => [...folders].sort(),
    paths: () => [...files.keys()].sort(),
  };
}
