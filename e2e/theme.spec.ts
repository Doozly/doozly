import { expect, test } from "./fixtures.ts";
import { settingStored, waitForStored } from "./helpers.ts";

const background = () => getComputedStyle(document.body).backgroundColor;

test("follows the system theme by default", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/lists/inbox");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  expect(await page.evaluate(background)).toBe("rgb(27, 27, 30)");
});

test("a saved dark override applies before the app even runs", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("doozly:theme", "dark"));
  // No app code at all, so only theme-init.js can have set it
  await page.route(/\/(assets\/.*\.js|src\/.*)$/, (route) => route.abort());
  await page.goto("/lists/inbox");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(background)).toBe("rgb(27, 27, 30)");
});

test("choosing Dark in Settings sticks after a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/lists/inbox");
  await page.getByRole("button", { name: "Settings" }).click();
  // Clicks while the sheet still slides in can miss, like a real hand would
  await expect(page.locator("[data-entering]")).toHaveCount(0);
  // React Aria hides the real input, people click the label
  await page.locator("label", { hasText: /^Dark$/ }).click();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await waitForStored(page, "settings", settingStored("theme", "dark"));

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(background)).toBe("rgb(27, 27, 30)");
});
