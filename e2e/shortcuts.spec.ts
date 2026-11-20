import { expect, test } from "./fixtures.ts";
import { taskStored, waitForStored } from "./helpers.ts";

test("the whole task flow from the keyboard", async ({ page }) => {
  await page.goto("/lists/inbox");
  const add = page.getByRole("textbox", { name: "Add a task" });
  await expect(add).toBeVisible();
  await page.locator("body").press("n");
  await expect(add).toBeFocused();
  for (const title of ["Milk", "Bread", "Eggs"]) {
    await add.fill(title);
    await add.press("Enter");
  }
  // New tasks go on top, so the list reads Eggs, Bread, Milk
  await add.press("Tab");
  const row = (name: string) => page.getByRole("link", { name, exact: true });
  await row("Eggs").focus();
  await page.keyboard.press("ArrowDown");
  await expect(row("Bread")).toBeFocused();

  await page.keyboard.press("s");
  await page.keyboard.press("t");
  await expect(
    page.getByRole("list", { name: "Tasks", exact: true }),
  ).toContainText("My Day");
  await page.keyboard.press("Enter");
  const details = page.getByRole("complementary", { name: "Task details" });
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(row("Bread")).toBeFocused();

  await page.keyboard.press("d");
  await expect(
    page.getByRole("list", { name: "Completed tasks" }),
  ).toContainText("Bread");
  await waitForStored(page, "tasks", taskStored("Bread", "done"));

  await row("Milk").focus();
  await page.keyboard.press("Delete");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete task" })
    .click();
  await waitForStored(page, "tasks", taskStored("Milk", "deleted"));
  // The next row down, which is Bread under Completed now
  await expect(row("Bread")).toBeFocused();
});

test("search, new list, sidebar and help keys, without the browser's own", async ({
  page,
}) => {
  await page.goto("/lists/inbox");
  await expect(page.getByRole("textbox", { name: "Add a task" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search" });
  // In Firefox "/" is Quick Find, it must come to us instead
  await page.locator("body").press("/");
  await expect(search).toBeFocused();
  await search.press("Tab");

  await page.locator("body").press("l");
  const name = page.getByRole("textbox", { name: "List name" });
  await expect(name).toBeFocused();
  await name.fill("Errands");
  await name.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Errands" }),
  ).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Lists" });
  await page.locator("body").press("1");
  await expect(nav).toBeHidden();
  await page.locator("body").press("1");
  await expect(nav).toBeVisible();

  await page.locator("body").press("Shift+?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
});
