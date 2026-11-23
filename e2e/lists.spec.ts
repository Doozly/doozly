import { expect, test } from "./fixtures.ts";
import { waitForStored } from "./helpers.ts";

test("a new list opens, and is still there after a reload", async ({
  page,
}) => {
  await page.goto("/lists/inbox");
  const lists = page.getByRole("navigation", { name: "Lists" });
  await lists.getByRole("textbox", { name: "New list" }).fill("Groceries");
  await lists.getByRole("textbox", { name: "New list" }).press("Enter");

  await expect(
    page.getByRole("heading", { level: 1, name: "Groceries" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]{36}$/);

  await waitForStored<{ title: string; deletedAt: number | null }>(
    page,
    "lists",
    (rows) =>
      rows.some(
        (l) => l.title === "Groceries" && (l.deletedAt !== null) === false,
      ),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Groceries" }),
  ).toBeVisible();
  await expect(lists.getByRole("link", { name: "Groceries" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("rename, duplicate and delete a list", async ({ page }) => {
  await page.goto("/lists/inbox");
  const lists = page.getByRole("navigation", { name: "Lists" });
  await lists.getByRole("textbox", { name: "New list" }).fill("Groceries");
  await lists.getByRole("textbox", { name: "New list" }).press("Enter");
  await page.getByRole("textbox", { name: "Add a task" }).fill("Milk");
  await page.getByRole("textbox", { name: "Add a task" }).press("Enter");

  await page.getByRole("heading", { level: 1 }).getByRole("button").click();
  const name = page.getByRole("textbox", { name: "List name" });
  await name.fill("Food shop");
  await name.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Food shop");

  await page.getByRole("button", { name: "List options" }).click();
  await page.getByRole("menuitem", { name: "Duplicate list" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Food shop (1)",
  );
  await expect(page.getByRole("checkbox", { name: "Milk" })).toBeVisible();

  await lists
    .getByRole("link", { name: /^Food shop \(1\)/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete list" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete list" })
    .click();
  await expect(page).toHaveURL(/\/lists\/my-day$/);
  await expect(page.locator("#root")).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );

  await waitForStored<{ title: string; deletedAt: number | null }>(
    page,
    "lists",
    (rows) =>
      rows.some(
        (l) => l.title === "Food shop (1)" && (l.deletedAt !== null) === true,
      ),
  );
  await page.reload();
  await expect(lists.getByRole("link", { name: /^Food shop/ })).toHaveCount(1);
});

test("printing a list prints just the list", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      (window as unknown as { printed: boolean }).printed = true;
    };
  });
  await page.goto("/lists/inbox");
  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill("Milk");
  await add.press("Enter");
  await expect(page.getByRole("link", { name: "Milk" })).toBeVisible();

  await page.getByRole("button", { name: "List options" }).click();
  await page.getByRole("menuitem", { name: "Print list" }).click();
  await expect.poll(() => page.evaluate(() => "printed" in window)).toBe(true);

  await page.emulateMedia({ media: "print" });
  const sheet = page.locator("#print-root");
  await expect(sheet.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(sheet.getByText("Milk")).toBeVisible();
  await expect(page.locator("#root")).toBeHidden();
});
