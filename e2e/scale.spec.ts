import { expect, type Page, test } from "./fixtures.ts";
import { waitForStored } from "./helpers.ts";
import { bigExport } from "./perf-seed.ts";

// Timings in CI wobble a lot, so the limits are generous. They catch a list that got slow, not a few ms.
// GitHub's runners are also about half as quick as a dev machine, so there they get double.
const SLOWER = process.env.CI ? 2 : 1;
const INSTANT_MS = 200 * SLOWER;
const SMOOTH_MS = 500 * SLOWER;

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "One engine is enough to see the app stays fast",
);

async function importBig(page: Page) {
  await page.goto("/lists/inbox");
  await page.getByRole("button", { name: "Settings" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import" }).click();
  await (await chooser).setFiles({
    name: "big.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bigExport())),
  });
  await expect(
    page.getByText(/^Imported \d+ lists and 5000 tasks\.$/),
  ).toBeVisible({ timeout: 30_000 });
  const saving = await timed(() =>
    waitForStored(page, "tasks", (rows) => rows.length >= 5000),
  );
  console.log(`import saved after a further ${saving} ms`);
  await page.keyboard.press("Escape");
}

async function timed(what: () => Promise<void>) {
  const start = Date.now();
  await what();
  return Date.now() - start;
}

test("five thousand tasks in fifty lists stay quick", async ({ page }) => {
  test.slow();
  await importBig(page);

  const opening = await timed(async () => {
    await page.reload();
    await expect(page.getByRole("link", { name: /^List 49/ })).toBeVisible();
  });
  console.log(`open with 5000 tasks: ${opening} ms`);

  const switching = await timed(async () => {
    await page.getByRole("link", { name: /^List 7 / }).click();
    await expect(page.getByRole("link", { name: /number 798$/ })).toBeVisible();
  });
  console.log(`switch to a 100 task list: ${switching} ms`);
  expect(switching).toBeLessThan(SMOOTH_MS);

  const add = page.getByRole("textbox", { name: "Add a task" });
  const entries: number[] = [];
  for (let i = 0; i < 5; i++) {
    await add.fill(`Quick one ${i}`);
    entries.push(
      await timed(async () => {
        await add.press("Enter");
        await expect(
          page.getByRole("link", { name: `Quick one ${i}` }),
        ).toBeVisible();
      }),
    );
  }
  console.log(`task entry: ${entries.join(", ")} ms`);
  expect(Math.max(...entries)).toBeLessThan(INSTANT_MS);
  await expect(page.getByRole("progressbar")).toHaveCount(0);

  const search = page.getByRole("searchbox", { name: "Search" });
  const searching = await timed(async () => {
    await search.pressSequentially("dentist", { delay: 0 });
    await expect(
      page.getByRole("heading", { level: 1, name: 'Searching for "dentist"' }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /dentist .* number 4967$/ }),
    ).toBeVisible();
  });
  console.log(`search across 5000 tasks: ${searching} ms`);
  expect(searching).toBeLessThan(SMOOTH_MS * 2);

  await search.press("Escape");
  const tasks = page.getByRole("main").getByRole("checkbox");
  const all = await timed(async () => {
    await page.getByRole("link", { name: /^All( |$)/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "All" }),
    ).toBeVisible();
    await expect(tasks.first()).toBeVisible();
  });
  console.log(`All, first rows: ${all} ms`);
  expect(all).toBeLessThan(SMOOTH_MS);
  // 3300 open ones plus the five from above, the rest fills in after
  const rest = await timed(() => expect(tasks).toHaveCount(3305));
  console.log(`All, every row: a further ${rest} ms`);
});
