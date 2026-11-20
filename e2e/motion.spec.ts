import { expect, type Page, test } from "./fixtures.ts";

/** Records what gets animated: a task row by its title, "ghost" for a copy on its way out */
async function watchAnimations(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { __animated: seen });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args) {
      const el = this as HTMLElement;
      if (el.dataset.taskId) seen.push(`row:${el.textContent?.trim() ?? ""}`);
      if ("ghost" in el.dataset)
        seen.push(`ghost:${el.textContent?.trim() ?? ""}`);
      return animate.apply(this, args);
    };
  });
}

const animated = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __animated: string[] }).__animated,
  );

async function addTasks(page: Page, ...titles: string[]) {
  const add = page.getByRole("textbox", { name: "Add a task" });
  for (const title of titles) {
    await add.fill(title);
    await add.press("Enter");
  }
}

const tick = (page: Page, title: string) =>
  page
    .locator("label", { has: page.getByRole("checkbox", { name: title }) })
    .click();

test("completing, adding, deleting and closing the details animate", async ({
  page,
}) => {
  await page.goto("/lists/inbox");
  await addTasks(page, "Milk", "Bread");
  await watchAnimations(page);

  await tick(page, "Bread");
  await expect(
    page.getByRole("list", { name: "Completed tasks" }),
  ).toContainText("Bread");
  await expect
    .poll(() => animated(page))
    .toContainEqual(expect.stringMatching(/^row:Bread/));

  await addTasks(page, "Eggs");
  await expect
    .poll(() => animated(page))
    .toContainEqual(expect.stringMatching(/^row:Eggs/));

  await page.getByRole("link", { name: "Milk" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete task" })
    .click();
  await expect
    .poll(() => animated(page))
    .toContainEqual(expect.stringMatching(/^ghost:.*Milk/));
  // The copy goes once it has faded
  await expect(page.locator("[data-ghost]")).toHaveCount(0);

  await page.getByRole("link", { name: "Eggs" }).click();
  const pane = page.getByRole("complementary", { name: "Task details" });
  await pane.getByRole("button", { name: "Close details" }).click();
  await expect(pane).toBeHidden();
  await expect
    .poll(() => animated(page))
    .toContainEqual(expect.stringMatching(/^ghost:.*Eggs/));
});

test("ticking quickly loses no clicks while rows move", async ({ page }) => {
  await page.goto("/lists/inbox");
  await addTasks(page, "One", "Two", "Three");
  const done = page.getByRole("list", { name: "Completed tasks" });
  // Straight after each other, while the first row is still on its way down
  await tick(page, "Three");
  await tick(page, "Two");
  await tick(page, "One");
  await expect(done.getByRole("link")).toHaveCount(3);
});

test("reduced motion changes at once, nothing animates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/lists/inbox");
  await addTasks(page, "Milk");
  await watchAnimations(page);
  await tick(page, "Milk");
  await expect(
    page.getByRole("list", { name: "Completed tasks" }),
  ).toContainText("Milk");
  expect(await animated(page)).toEqual([]);
});
