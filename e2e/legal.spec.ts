import { expect, test } from "./fixtures.ts";

test("the privacy and terms pages open and link to each other", async ({
  page,
}) => {
  await page.goto("/privacy.html");
  await expect(
    page.getByRole("heading", { level: 1, name: "Privacy policy" }),
  ).toBeVisible();
  await expect(page.getByText(/Limited Use requirements/)).toBeVisible();
  await page.getByRole("link", { name: "Terms of use" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Terms of use" }),
  ).toBeVisible();
});

test("the landing page links to both", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    "/privacy",
  );
  await expect(page.getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    "/terms",
  );
});

test("once the service worker runs the app, the pages still load as pages", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Service workers: Chromium only");
  await page.goto("/lists/inbox");
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

  // The worker answers unknown paths with the app. These must come out of its precache as the real pages, also without .html.
  for (const [path, title] of [
    ["/privacy", "Privacy policy - Doozly"],
    ["/terms", "Terms of use - Doozly"],
    ["/privacy.html", "Privacy policy - Doozly"],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
  }
});
