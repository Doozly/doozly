import { expect, test } from "./fixtures.ts";

// Service workers in Playwright are reliable in Chromium only
test.skip(({ browserName }) => browserName !== "chromium", "Chromium only");

test("after one visit the app opens and works offline", async ({
  page,
  context,
}) => {
  await page.goto("/lists/inbox");
  await expect(page.getByRole("textbox", { name: "Add a task" })).toBeVisible();
  // The worker has precached everything once it's in control
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

  await context.setOffline(true);
  // A deep link, not just the start page
  await page.goto("/lists/inbox");
  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill("Offline milk");
  await add.press("Enter");
  await expect(page.getByRole("link", { name: "Offline milk" })).toBeVisible();
  // Lazy chunks come from the cache too
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Offline milk" }).click();
  const pane = page.getByRole("complementary", { name: "Task details" });
  await pane.getByRole("button", { name: "Add due date" }).click();
  await page.getByRole("menuitem", { name: "Pick a date" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: "Offline milk" })).toBeVisible();
});
