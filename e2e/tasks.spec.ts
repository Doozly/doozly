import { expect, test } from "@playwright/test";
import { taskStored, waitForStored } from "./helpers.ts";

test("add, complete and delete a task", async ({ page }) => {
  await page.goto("/");
  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill("Buy milk");
  await add.press("Enter");
  await add.fill("Call mum");
  await add.press("Enter");
  await expect(add).toBeFocused();

  const open = page.getByRole("list", { name: "Tasks", exact: true });
  await expect(open.getByRole("checkbox")).toHaveCount(2);

  await page
    .locator("label", { has: page.getByRole("checkbox", { name: "Buy milk" }) })
    .click();
  const completed = page.getByRole("list", { name: "Completed tasks" });
  await expect(
    completed.getByRole("checkbox", { name: "Buy milk" }),
  ).toBeChecked();

  await page.getByRole("link", { name: "Call mum" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  // The page must be back for screen readers after the dialog
  await expect(page.locator("#root")).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(open.getByRole("link", { name: "Call mum" })).toBeVisible();

  await page.getByRole("link", { name: "Call mum" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete task" })
    .click();
  await expect(page.getByRole("link", { name: "Call mum" })).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );

  await waitForStored(page, "tasks", taskStored("Call mum", "deleted"));
  await page.reload();
  await expect(page.getByRole("link", { name: "Call mum" })).toHaveCount(0);
  await expect(
    page
      .getByRole("list", { name: "Completed tasks" })
      .getByRole("checkbox", { name: "Buy milk" }),
  ).toBeChecked();
});
