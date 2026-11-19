import { expect, type Page } from "@playwright/test";

type Store = "lists" | "groups" | "tasks" | "steps" | "settings";

/** Reads a store straight from the page's IndexedDB */
export function stored<T = Record<string, unknown>>(
  page: Page,
  store: Store,
): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open("doozly");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const read = open.result.transaction(name).objectStore(name).getAll();
          read.onsuccess = () => {
            resolve(read.result as T[]);
            open.result.close();
          };
          read.onerror = () => reject(read.error);
        };
      }),
    store,
  );
}

/**
 * Waits until the change has really landed in IndexedDB. A reload right after a
 * click can otherwise beat the write and throw it away.
 */
export async function waitForStored<T = Record<string, unknown>>(
  page: Page,
  store: Store,
  check: (rows: T[]) => boolean,
) {
  await expect.poll(async () => check(await stored<T>(page, store))).toBe(true);
}

interface StoredTask {
  title: string;
  completedAt: number | null;
  deletedAt: number | null;
}

export const taskStored =
  (title: string, state: "open" | "done" | "deleted") => (rows: StoredTask[]) =>
    rows.some(
      (t) =>
        t.title === title &&
        (state === "deleted"
          ? t.deletedAt !== null
          : t.deletedAt === null &&
            (state === "done") === (t.completedAt !== null)),
    );

export const settingStored =
  (key: string, value: unknown) => (rows: { key: string; value: unknown }[]) =>
    rows.some((r) => r.key === key && r.value === value);
