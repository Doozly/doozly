import { createDropboxAuth } from "./dropbox/auth.ts";
import { createDropboxProvider } from "./dropbox/dropboxProvider.ts";
import { createGoogleAuth } from "./google/auth.ts";
import {
  createDriveProvider,
  DRIVE_API,
  DRIVE_UPLOAD,
} from "./google/driveProvider.ts";
import { createMicrosoftAuth } from "./microsoft/auth.ts";
import {
  APP_ROOT,
  createOneDriveProvider,
} from "./microsoft/oneDriveProvider.ts";
import { ConflictError, type StorageProvider } from "./provider.ts";

// Dev only, at /dev/sync: tries the providers and the APIs' quirks against real accounts

type Say = (line: string) => void;
type Raw = (url: string, init?: RequestInit) => Promise<Response>;

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reporter(say: Say) {
  return {
    check: (ok: boolean, what: string) =>
      say(`${ok ? "PASS" : "FAIL"}  ${what}`),
    info: (what: string) => say(`INFO  ${what}`),
  };
}

const rawWith =
  (token: string): Raw =>
  (url, init = {}) =>
    fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });

const conflict = (p: Promise<unknown>) =>
  p.then(
    () => false,
    (e: unknown) => e instanceof ConflictError,
  );

/** What every provider promises, against the real thing */
async function conformance(provider: StorageProvider, say: Say) {
  const { check, info } = reporter(say);
  const a = "probe/a.json";

  await provider.write(a, bytes('{"n":1}'), null);
  check(
    text((await provider.read(a))?.data) === '{"n":1}',
    "create in a new folder, then read it back",
  );
  const fresh = await provider.read(a);
  check(
    await conflict(provider.write(a, bytes("{}"), null)),
    "create-only on an existing file is a conflict",
  );
  await provider.write(a, bytes('{"n":2}'), fresh?.etag);
  check(
    await conflict(provider.write(a, bytes("{}"), fresh?.etag)),
    "a stale ETag is a conflict",
  );

  const feed = await provider.changesSince();
  check(feed.changed.includes(a), "a full change feed lists the file");
  await provider.write("probe/b.json", bytes("{}"));
  let seen = false;
  const started = performance.now();
  while (!seen && performance.now() - started < 20_000) {
    const next = await provider.changesSince(feed.token);
    seen = next.changed.includes("probe/b.json");
    if (!seen) await wait(1000);
  }
  check(
    seen,
    `the change feed shows a new write (after ${Math.round(performance.now() - started)} ms)`,
  );

  const gone = (await provider.read(a))?.etag;
  await provider.delete(a);
  check((await provider.read(a)) === null, "a deleted file reads as gone");
  // Drive and Dropbox call this a conflict, OneDrive makes the file again. Either is fine, nothing may be lost.
  const conflicted = await conflict(provider.write(a, bytes('{"n":3}'), gone));
  const again = text((await provider.read(a))?.data);
  check(
    conflicted ? again === "" : again === '{"n":3}',
    `writing over a deleted file with its old ETag: ${conflicted ? "a conflict" : "makes it again"}`,
  );

  const t0 = performance.now();
  for (let i = 0; i < 3; i++) await provider.write(a, bytes(`{"i":${i}}`));
  const t1 = performance.now();
  for (let i = 0; i < 3; i++) await provider.read(a);
  const t2 = performance.now();
  info(
    `about ${Math.round((t1 - t0) / 3)} ms per write, ${Math.round((t2 - t1) / 3)} ms per read`,
  );
}

async function cleanUp(provider: StorageProvider, say: Say) {
  for (const f of await provider.list()) {
    if (f.path.startsWith("probe/")) await provider.delete(f.path);
  }
  const left = (await provider.list()).filter((f) =>
    f.path.startsWith("probe/"),
  );
  reporter(say).check(left.length === 0, "probe files cleaned up");
}

async function google(clientId: string, say: Say) {
  const { check, info } = reporter(say);
  const auth = createGoogleAuth({ clientId });
  const account = await auth.signIn();
  info(`signed in as ${account.email}`);
  const raw = rawWith(await auth.token());
  const provider = createDriveProvider({ token: auth.token });
  info(`appDataFolder holds ${(await provider.list()).length} file(s)`);

  try {
    // Does v3 quietly still do If-Match?
    const a = "probe/if-match.json";
    await provider.write(a, bytes('{"n":1}'));
    const q = new URLSearchParams({
      spaces: "appDataFolder",
      q: `name = '${a}'`,
      fields: "files(id)",
    });
    const found = await raw(`${DRIVE_API}/files?${q}`);
    const id = ((await found.json()) as { files: { id: string }[] }).files[0]
      ?.id;
    const bogus = await raw(
      `${DRIVE_UPLOAD}/files/${id}?uploadType=media&fields=version`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": '"doozly-not-a-real-etag"',
        },
        body: '{"n":2}',
      },
    );
    info(`upload PATCH with a bogus If-Match: ${bogus.status}`);

    await conformance(provider, say);

    // Two devices making the same file: the raw way, so both land
    const dup = "probe/dup.json";
    for (const n of [1, 2]) {
      await raw(`${DRIVE_UPLOAD}/files?uploadType=multipart`, {
        method: "POST",
        headers: { "Content-Type": "multipart/related; boundary=probe" },
        body:
          `--probe\r\nContent-Type: application/json\r\n\r\n` +
          `${JSON.stringify({ name: dup, parents: ["appDataFolder"] })}\r\n` +
          `--probe\r\nContent-Type: application/json\r\n\r\n{"n":${n}}\r\n--probe--`,
      });
    }
    check(
      text((await provider.read(dup))?.data) === '{"n":1}',
      "with a duplicate, everyone reads the oldest",
    );
    check(
      (await provider.list()).filter((f) => f.path === dup).length === 1,
      "a duplicate shows up once in the list",
    );
  } finally {
    await cleanUp(provider, say);
  }
}

async function microsoft(clientId: string, say: Say) {
  const { info } = reporter(say);
  // No restore(): a fresh popup with the account picker, so any account can be tried
  const auth = createMicrosoftAuth({ clientId });
  const account = await auth.signIn();
  info(
    `signed in as ${account.email} (${account.work ? "work or school" : "personal"} account)`,
  );
  const raw = rawWith(await auth.token());

  const root = await raw(APP_ROOT);
  info(`app folder: ${root.status}`);
  if (!root.ok) {
    info(`=> ${await root.text()}`);
    info(
      account.work
        ? "=> no app folder for this work account"
        : "=> no app folder",
    );
    return;
  }
  const folder = (await root.json()) as { webUrl?: string };
  info(`app folder lives at ${folder.webUrl ?? "(no webUrl)"}`);
  const provider = createOneDriveProvider({ token: auth.token });
  info(`app folder holds ${(await provider.list()).length} file(s)`);

  try {
    const delta = await raw(`${APP_ROOT}/delta?token=latest`);
    info(`delta on the app folder: ${delta.status}`);
    const bogus = await raw(`${APP_ROOT}:/probe/x.json:/content`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": '"doozly-not-a-real-etag"',
      },
      body: "{}",
    });
    info(`PUT with If-Match on a file that isn't there: ${bogus.status}`);

    await conformance(provider, say);
  } finally {
    await cleanUp(provider, say);
    await raw(`${APP_ROOT}:/probe:`, { method: "DELETE" });
  }
}

async function dropbox(clientId: string, say: Say) {
  const { check, info } = reporter(say);
  // No relay: a 4 hour token is plenty, and the probe's sign-in stays out of the app's
  const auth = createDropboxAuth({ clientId });
  const account = await auth.signIn();
  info(`signed in as ${account.email}`);
  const provider = createDropboxProvider({ token: auth.token });
  info(`app folder holds ${(await provider.list()).length} file(s)`);

  try {
    await conformance(provider, say);
    // Dropbox keeps cursors, so one from an earlier instance must still work
    const { token } = await provider.changesSince();
    const other = createDropboxProvider({ token: auth.token });
    check(
      Array.isArray((await other.changesSince(token)).changed),
      "a change token works in another instance",
    );
  } finally {
    await cleanUp(provider, say);
    await auth.signOut();
  }
}

const probes = { google, microsoft, dropbox };

export function mountSyncProbe(root: HTMLElement) {
  const ids = {
    google: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    microsoft: import.meta.env.VITE_MICROSOFT_CLIENT_ID,
    dropbox: import.meta.env.VITE_DROPBOX_CLIENT_ID,
  };
  root.innerHTML = `<main style="font: 14px/1.5 monospace; padding: 16px">
    <h1>Sync probe</h1>
    <button type="button" data-run="google">Google Drive</button>
    <button type="button" data-run="microsoft">OneDrive</button>
    <button type="button" data-run="dropbox">Dropbox</button>
    <pre></pre></main>`;
  const out = root.querySelector("pre") as HTMLPreElement;
  const say = (line: string) => {
    out.textContent += `${line}\n`;
  };
  // Load Google's script now, so the click still counts as one when the popup opens
  if (ids.google) void createGoogleAuth({ clientId: ids.google }).preload();

  for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
    const which = button.dataset.run as keyof typeof ids;
    const clientId = ids[which];
    if (!clientId) {
      button.disabled = true;
      button.title = "No client ID set, see .env.example";
      continue;
    }
    button.onclick = () => {
      button.disabled = true;
      out.textContent = "";
      probes[which](clientId, say)
        .then(() => say("done"))
        .catch((err: unknown) => say(`ERROR ${String(err)}`))
        .finally(() => {
          button.disabled = false;
        });
    };
  }
}
