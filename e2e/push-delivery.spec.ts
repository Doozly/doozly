import { expect, test } from "./fixtures.ts";

// Only Chromium lets a test hand the worker a push, through DevTools. Its headless
// shell refuses notifications outright, full Chromium in headless mode allows them.
test.skip(({ browserName }) => browserName !== "chromium", "needs Chromium");
test.use({ channel: "chromium" });

test("the service worker opens a sealed push and shows the task", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["notifications"], { origin: baseURL });
  const cdp = await context.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  const registered = new Promise<string>((resolve) => {
    cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
      const r = registrations.find((x) => !x.isDeleted);
      if (r) resolve(r.registrationId);
    });
  });

  await page.goto("/lists/inbox");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const registrationId = await registered;

  // A key in the settings like a sync would bring it, and a payload sealed with it
  const message = await page.evaluate(async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("doozly");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("settings", "readwrite");
        tx.objectStore("settings").put({
          key: "reminderKey",
          value: b64(raw),
          updatedAt: "0",
        });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
      "encrypt",
    ]);
    const id = "t1@1";
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(
      JSON.stringify({
        title: "Call the dentist",
        list: "Tasks",
        taskId: "t1",
        listId: "inbox",
      }),
    );
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) },
        key,
        plain,
      ),
    );
    const payload = new Uint8Array(12 + sealed.length);
    payload.set(iv);
    payload.set(sealed, 12);
    return JSON.stringify({ id, payload: b64(payload) });
  });

  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin: new URL(page.url()).origin,
    registrationId,
    data: message,
  });

  // Decrypting in the worker can take a moment when the machine is busy
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.ready;
          return (await reg.getNotifications()).map((n) => [
            n.title,
            n.body,
            n.tag,
            (n.data as { path: string }).path,
          ]);
        }),
      { timeout: 15_000 },
    )
    .toEqual([["Call the dentist", "Tasks", "t1@1", "/lists/inbox/tasks/t1"]]);
});
