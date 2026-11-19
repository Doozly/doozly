import { expect, test } from "@playwright/test";
import { stored } from "./helpers.ts";

test("app loads on the Tasks list", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/lists\/inbox$/);
  await expect(page).toHaveTitle("Tasks - Doozly");
  await expect(page.getByRole("img", { name: "Doozly" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
});

test("a deep link still works after a reload", async ({ page }) => {
  await page.goto("/lists/inbox");
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
});

test("storage opens and holds the built-in Tasks list", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
  const listIds = (await stored<{ id: string }>(page, "lists")).map(
    (l) => l.id,
  );
  expect(listIds).toEqual(["inbox"]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("the lists live in a drawer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Lists" })).toBeHidden();
    await page.getByRole("button", { name: "Show lists" }).click();
    const drawer = page.getByRole("dialog", { name: "Lists" });
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });
});
