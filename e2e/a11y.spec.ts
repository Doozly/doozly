import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "./fixtures.ts";

// Axe looks at the DOM and the computed styles, which don't differ between engines enough
// to be worth three runs
test.skip(({ browserName }) => browserName !== "chromium", "Chromium only");

/** Fails with axe's findings, readable, when anything at WCAG 2.2 AA breaks */
async function check(page: Page, what: string) {
  // Let entering animations finish, mid-fade colours aren't real
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const found = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n${v.nodes
        .slice(0, 5)
        .map(
          (n) =>
            `    ${n.target.join(" ")}: ${n.failureSummary?.split("\n")[1]?.trim()}`,
        )
        .join("\n")}`,
  );
  expect(found, what).toEqual([]);
}

async function seed(page: Page) {
  const add = page.getByRole("textbox", { name: "Add a task" });
  for (const title of ["Pay rent", "Buy milk", "Call mum", "Old thing"]) {
    await add.fill(title);
    await add.press("Enter");
  }
  const star = page.getByRole("button", { name: "Important: Pay rent" });
  await star.click();
  await page
    .locator("label", {
      has: page.getByRole("checkbox", { name: "Old thing" }),
    })
    .click();
  await page.getByRole("link", { name: "Buy milk" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to My Day" }).click();
  await page.getByRole("link", { name: "Call mum" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Due today" }).click();
}

for (const scheme of ["light", "dark"] as const) {
  test(`the landing page passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Get started" }),
    ).toBeVisible();
    await check(page, "landing page");
  });

  test(`lists, details, menus and dialogs pass axe (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/lists/inbox");
    await seed(page);
    await check(page, "Tasks with open, done, starred, My Day and due tasks");

    for (const list of ["My Day", "Important", "Planned", "All"]) {
      await page
        .getByRole("navigation", { name: "Lists" })
        .getByRole("link", { name: new RegExp(`^${list}`) })
        .click();
      await expect(
        page.getByRole("heading", { level: 1, name: list }),
      ).toBeVisible();
      await check(page, list);
    }

    await page
      .getByRole("navigation", { name: "Lists" })
      .getByRole("link", { name: /^Tasks/ })
      .click();
    await page.getByRole("link", { name: "Pay rent" }).click();
    await check(page, "details pane");

    const pane = page.getByRole("complementary", { name: "Task details" });
    await pane.getByRole("button", { name: "Remind me" }).click();
    await check(page, "reminder menu");
    await page.keyboard.press("Escape");
    await pane.getByRole("button", { name: "Add due date" }).click();
    await page.getByRole("menuitem", { name: "Pick a date" }).click();
    await check(page, "date picker");
    await page.keyboard.press("Escape");
    await pane.getByRole("button", { name: "Close details" }).click();

    await page
      .getByRole("link", { name: "Buy milk" })
      .click({ button: "right" });
    await check(page, "task menu");
    await page.getByRole("menuitem", { name: "Delete task" }).click();
    await check(page, "delete question");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Cancel" })
      .click();

    await page.getByRole("button", { name: "List options" }).click();
    await check(page, "list menu");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await check(page, "settings");
    await page.getByRole("button", { name: "Show keyboard shortcuts" }).click();
    await check(page, "keyboard shortcuts");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();

    await page
      .getByRole("button", { name: /Account|Sign in/ })
      .first()
      .click();
    await check(page, "account popover");
    await page.keyboard.press("Escape");

    await page.getByRole("searchbox", { name: "Search" }).fill("mi");
    await check(page, "search results");
  });
}

test("a list with a theme and a background passes axe", async ({ page }) => {
  await page.goto("/lists/inbox");
  const lists = page.getByRole("navigation", { name: "Lists" });
  await lists.getByRole("textbox", { name: "New list" }).fill("Trips");
  await lists.getByRole("textbox", { name: "New list" }).press("Enter");
  await page.getByRole("textbox", { name: "Add a task" }).fill("Passport");
  await page.getByRole("textbox", { name: "Add a task" }).press("Enter");
  await page.getByRole("button", { name: "List options" }).click();
  await page.getByRole("menuitem", { name: /theme/i }).click();
  await check(page, "theme picker");
  const picker = page.getByRole("dialog");
  // React Aria hides the real inputs, people click what they see
  await picker.locator("label").nth(5).click();
  await picker.locator("label").last().click();
  await page.keyboard.press("Escape");
  await check(page, "themed list");
});

test("the phone layout and its drawer pass axe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/lists/inbox");
  await page.getByRole("textbox", { name: "Add a task" }).fill("Milk");
  await page.getByRole("textbox", { name: "Add a task" }).press("Enter");
  await check(page, "phone list");
  await page.getByRole("button", { name: "Show lists" }).click();
  await check(page, "drawer");
});
