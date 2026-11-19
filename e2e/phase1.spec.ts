import { expect, test } from "@playwright/test";
import { settingStored, taskStored, waitForStored } from "./helpers.ts";

// The whole phase 1 flow in one go, the way someone would actually use it
test("phase 1 journey: lists, tasks, persistence, theme and the phone drawer", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const lists = page.getByRole("navigation", { name: "Lists" });
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText("Tasks");

  // Create a list, it opens straight away
  await lists.getByRole("textbox", { name: "New list" }).fill("Groceries");
  await lists.getByRole("textbox", { name: "New list" }).press("Enter");
  await expect(title).toHaveText("Groceries");

  // Add tasks; the newest goes on top and the box keeps focus
  const add = page.getByRole("textbox", { name: "Add a task" });
  for (const task of ["Milk", "Bread", "Eggs"]) {
    await add.fill(task);
    await add.press("Enter");
  }
  await expect(add).toBeFocused();
  const open = page.getByRole("list", { name: "Tasks", exact: true });
  await expect(open.getByRole("checkbox")).toHaveCount(3);
  await expect(open.getByRole("link")).toHaveText(["Eggs", "Bread", "Milk"]);

  // Complete one
  await page
    .locator("label", { has: page.getByRole("checkbox", { name: "Bread" }) })
    .click();
  const completed = page.getByRole("list", { name: "Completed tasks" });
  await expect(
    completed.getByRole("checkbox", { name: "Bread" }),
  ).toBeChecked();
  await expect(
    lists.getByRole("link", { name: "Groceries 2 open tasks" }),
  ).toBeVisible();

  // Everything is still there after a reload
  await waitForStored(page, "tasks", taskStored("Bread", "done"));
  await page.reload();
  await expect(title).toHaveText("Groceries");
  await expect(open.getByRole("link")).toHaveText(["Eggs", "Milk"]);
  await expect(
    completed.getByRole("checkbox", { name: "Bread" }),
  ).toBeChecked();
  await expect(
    lists.getByRole("link", { name: "Groceries 2 open tasks" }),
  ).toHaveAttribute("aria-current", "page");

  // Switch to the dark theme; it sticks
  await page.getByRole("button", { name: "Settings" }).click();
  // Clicks while the sheet still slides in can miss, like a real hand would
  await expect(page.locator("[data-entering]")).toHaveCount(0);
  await page.locator("label", { hasText: /^Dark$/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await waitForStored(page, "settings", settingStored("theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // On a phone the lists move into a drawer
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(lists).toBeHidden();
  await page.getByRole("button", { name: "Show lists" }).click();
  const drawer = page.getByRole("dialog", { name: "Lists" });
  await drawer.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(title).toHaveText("Tasks");

  await page.getByRole("button", { name: "Show lists" }).click();
  await drawer.getByRole("link", { name: /^Groceries/ }).click();
  await expect(title).toHaveText("Groceries");
  await expect(open.getByRole("link")).toHaveText(["Eggs", "Milk"]);
});
