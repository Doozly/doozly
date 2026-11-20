import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { expect, test } from "./fixtures.ts";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only");

const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

// Its own server over its own copy of the build, so it can "deploy" a new worker
// without touching the preview server the other tests share
let root = "";
let server: Server;
let origin = "";

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "doozly-update-"));
  cpSync("dist", root, { recursive: true });
  server = createServer((req, res) => {
    const path = normalize(
      decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname),
    );
    let file = join(root, path);
    let body: Buffer;
    try {
      body = readFileSync(file);
    } catch {
      file = join(root, "index.html");
      body = readFileSync(file);
    }
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://localhost:${typeof address === "object" && address ? address.port : 0}`;
});

test.afterAll(() => {
  server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

test("a new version waits for Reload, then takes over", async ({ page }) => {
  await page.goto(`${origin}/`);
  await expect(page.getByRole("textbox", { name: "Add a task" })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, {
          once: true,
        }),
      );
    }
  });
  const activeWorker = () =>
    page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg?.active ? `${reg.active.scriptURL}#${reg.active.state}` : null;
    });
  // Something to tell the old and the new worker apart by
  await page.evaluate(() => {
    Object.assign(window, {
      __oldController: navigator.serviceWorker.controller,
    });
  });

  // The next deploy: the same worker, one comment longer
  const sw = join(root, "sw.js");
  writeFileSync(sw, `${readFileSync(sw, "utf8")}\n// next\n`);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });

  const notice = page.getByRole("status").filter({ hasText: "new version" });
  await expect(notice).toBeVisible();
  // Nothing has taken over yet
  expect(
    await page.evaluate(
      () =>
        navigator.serviceWorker.controller ===
        (window as unknown as { __oldController: unknown }).__oldController,
    ),
  ).toBe(true);

  const reloaded = page.waitForEvent("load");
  await notice.getByRole("button", { name: "Reload" }).click();
  await reloaded;
  await expect(page.getByRole("textbox", { name: "Add a task" })).toBeVisible();
  await expect(notice).toBeHidden();
  expect(await activeWorker()).toMatch(/#activated$/);
  expect(
    await page.evaluate(
      async () =>
        (await navigator.serviceWorker.getRegistration())?.waiting ?? null,
    ),
  ).toBeNull();
});
