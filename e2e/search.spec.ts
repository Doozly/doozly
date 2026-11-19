import { expect, test } from "@playwright/test";

test("search across lists, open a result, then go back", async ({ page }) => {
  await page.goto("/lists/inbox");
  const add = page.getByRole("textbox", { name: "Add a task" });
  for (const t of ["Oat milk", "Bread"]) {
    await add.fill(t);
    await add.press("Enter");
  }

  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("MILK");
  await expect(
    page.getByRole("heading", { level: 1, name: 'Searching for "MILK"' }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Bread" })).toHaveCount(0);

  await page.getByRole("link", { name: "Oat milk" }).click();
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Oat milk",
  );

  await search.press("Escape");
  await expect(page).toHaveURL(/\/lists\/inbox$/);
  await expect(page.getByRole("link", { name: "Bread" })).toBeVisible();
});
