import {
  AuthError,
  ConflictError,
  type FileInfo,
  NoStorageError,
  ProviderError,
  type StorageProvider,
} from "../provider.ts";

export const GRAPH_DRIVE = "https://graph.microsoft.com/v1.0/me/drive";
export const APP_ROOT = `${GRAPH_DRIVE}/special/approot`;
const SELECT = "id,name,eTag,size,file,folder";

export interface GraphItem {
  id: string;
  name: string;
  eTag: string;
  size?: number;
  file?: object;
  folder?: object;
  "@microsoft.graph.downloadUrl"?: string;
}

interface OneDriveOptions {
  /** A valid access token, or throws AuthError */
  token: () => Promise<string>;
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

/** "lists/a b.json" to the path form Graph wants, ":/lists/a%20b.json:" */
const itemUrl = (path: string) =>
  `${APP_ROOT}:/${path.split("/").map(encodeURIComponent).join("/")}:`;

/** The OneDrive app folder (Apps/Doozly) as a StorageProvider. Graph has real If-Match, so conflicts are caught on the server. */
export function createOneDriveProvider({
  token,
  onUnauthorized,
  fetch: fetchImpl = (...args) => fetch(...args),
}: OneDriveOptions): StorageProvider {
  // Path to ETag as of each listing, so a later listing can tell what changed
  const scans = new Map<number, Map<string, string>>();
  let scanCount = 0;
  // Tokens from another provider instance must never match ours
  const instance = crypto.randomUUID().slice(0, 8);

  async function failure(res: Response, what: string): Promise<Error> {
    let code = "";
    let detail = "";
    let message = `${what}: Graph answered ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      code = body.error?.code ?? "";
      detail = body.error?.message ?? "";
      if (detail) message += ` (${detail})`;
    } catch {
      // No JSON in it, the status has to do
    }
    if (res.status === 401) {
      onUnauthorized?.();
      return new AuthError("Microsoft sign-in ran out");
    }
    // A tenant without SharePoint, or a user whose OneDrive was never set up
    if (/SPO license|mysite/i.test(detail)) {
      return new NoStorageError(
        "This Microsoft account has no OneDrive, so Doozly can't sync with it",
      );
    }
    if (res.status === 403 && /accessDenied/i.test(code)) {
      return new AuthError("Doozly has no access to its OneDrive folder");
    }
    const retryable =
      res.status === 429 || res.status === 403 || res.status >= 500;
    return new ProviderError(message, retryable);
  }

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

  /** `missingIsEmpty` for our own subfolders; the app folder itself is made by Graph on first use */
  async function children(
    url: string,
    missingIsEmpty: boolean,
  ): Promise<GraphItem[]> {
    const items: GraphItem[] = [];
    let next: string | undefined = `${url}?$select=${SELECT}&$top=999`;
    while (next) {
      const res = await call(
        next,
        "list the folder",
        {},
        missingIsEmpty ? [404] : [],
      );
      if (res.status === 404) return items;
      const body = (await res.json()) as {
        value?: GraphItem[];
        "@odata.nextLink"?: string;
      };
      items.push(...(body.value ?? []));
      next = body["@odata.nextLink"];
    }
    return items;
  }

  /** Every file in the app folder with its ETag. Our layout is only ever one folder deep. */
  async function scan(): Promise<Map<string, GraphItem>> {
    const files = new Map<string, GraphItem>();
    for (const item of await children(`${APP_ROOT}/children`, false)) {
      if (item.file) files.set(item.name, item);
      else if (item.folder) {
        for (const inner of await children(
          `${itemUrl(item.name)}/children`,
          true,
        )) {
          if (inner.file) files.set(`${item.name}/${inner.name}`, inner);
        }
      }
    }
    return files;
  }

  async function upload(
    path: string,
    data: Uint8Array,
    ifMatch?: string | null,
  ) {
    const params =
      ifMatch === null ? "?@microsoft.graph.conflictBehavior=fail" : "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (typeof ifMatch === "string") headers["If-Match"] = ifMatch;
    return call(
      `${itemUrl(path)}/content${params}`,
      `write ${path}`,
      { method: "PUT", headers, body: new Uint8Array(data) },
      [404, 409, 412],
    );
  }

  async function makeFolder(name: string) {
    await call(
      `${APP_ROOT}/children`,
      `make folder ${name}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      },
      [409],
    );
  }

  const provider: StorageProvider = {
    async read(path) {
      const meta = await call(itemUrl(path), `read ${path}`, {}, [404]);
      if (meta.status === 404) return null;
      const item = (await meta.json()) as GraphItem;
      // The download link is pre-signed, so no token goes with it
      const link = item["@microsoft.graph.downloadUrl"];
      let res: Response;
      try {
        res = link
          ? await fetchImpl(link)
          : await call(
              `${GRAPH_DRIVE}/items/${item.id}/content`,
              `read ${path}`,
            );
      } catch (err) {
        throw new ProviderError(`read ${path}: ${String(err)}`);
      }
      if (res.status === 404) return null;
      if (!res.ok) throw await failure(res, `read ${path}`);
      // The ETag is from before the download, so at worst it's older and the next write retries
      return { data: new Uint8Array(await res.arrayBuffer()), etag: item.eTag };
    },

    async write(path, data, ifMatch) {
      let res = await upload(path, data, ifMatch);
      const folder = path.includes("/") ? path.split("/")[0] : undefined;
      if (res.status === 404 && typeof ifMatch !== "string" && folder) {
        // Graph didn't make the folder on its own, so we do and try again
        await makeFolder(folder);
        res = await upload(path, data, ifMatch);
      }
      // 409: it exists and we only wanted to create. 412: someone wrote since. 404: shouldn't happen,
      // Graph makes a deleted file again even with If-Match, but if it does, it's gone.
      if (!res.ok) throw new ConflictError(path);
      return { etag: ((await res.json()) as GraphItem).eTag };
    },

    async delete(path) {
      await call(itemUrl(path), `delete ${path}`, { method: "DELETE" }, [404]);
    },

    async list(): Promise<FileInfo[]> {
      return [...(await scan())]
        .map(([path, item]) => ({
          path,
          etag: item.eTag,
          size: item.size ?? 0,
        }))
        .sort((a, b) => (a.path < b.path ? -1 : 1));
    },

    // Delta only works on the drive root for work accounts, and the app folder
    // scope can't see the root. The folder is small, so comparing listings does.
    async changesSince(since) {
      let before: Map<string, string> | undefined;
      let from = 0;
      if (since !== undefined) {
        const [owner, n] = since.split(":");
        from = Number(n);
        before = owner === instance ? scans.get(from) : undefined;
        if (!before) {
          throw new ProviderError(`Unknown change token ${since}`, false);
        }
      }
      const now = new Map(
        [...(await scan())].map(([path, item]) => [path, item.eTag]),
      );
      const changed = before
        ? [...new Set([...before.keys(), ...now.keys()])].filter(
            (p) => before.get(p) !== now.get(p),
          )
        : [...now.keys()];
      // Older listings are no use once a newer token is being used
      for (const n of scans.keys()) if (n < from) scans.delete(n);
      scans.set(++scanCount, now);
      return { changed: changed.sort(), token: `${instance}:${scanCount}` };
    },
  };

  return provider;
}
