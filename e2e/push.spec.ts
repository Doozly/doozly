import { expect, test } from "@playwright/test";

test("a click on a push while Doozly is open goes to the task", async ({
  page,
}) => {
  await page.goto("/");
  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill("Call the dentist");
  await add.press("Enter");
  const href = await page
    .getByRole("link", { name: "Call the dentist" })
    .getAttribute("href");
  await page.evaluate(async (path) => {
    await navigator.serviceWorker.ready;
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "doozly:open", path } }),
    );
  }, href);
  await expect(page).toHaveURL(href ?? "");
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
});

test("the manifest makes Doozly installable", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Doozly", display: "standalone" });
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
});
