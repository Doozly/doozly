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

test("the detail pane edits the title as you type", async ({ page }) => {
  await page.goto("/");
  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill("Buy milk");
  await add.press("Enter");
  await page.getByRole("link", { name: "Buy milk" }).click();

  const pane = page.getByRole("complementary", { name: "Task details" });
  await expect(pane.getByText("Created today")).toBeVisible();
  const title = pane.getByRole("textbox", { name: "Task title" });
  await title.click();
  await title.press("End");
  await title.pressSequentially(" and eggs");
  await expect(
    page.getByRole("link", { name: "Buy milk and eggs" }),
  ).toBeVisible();

  await waitForStored(page, "tasks", taskStored("Buy milk and eggs", "open"));
  await page.reload();
  await expect(pane.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Buy milk and eggs",
  );
  await page.keyboard.press("Escape");
  await pane.getByRole("textbox", { name: "Task title" }).focus();
  await page.keyboard.press("Escape");
  await expect(pane).toBeHidden();
});

test("a due date from the calendar sticks", async ({ page }) => {
  await page.goto("/");
  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill("Pay rent");
  await add.press("Enter");
  await page.getByRole("link", { name: "Pay rent" }).click();
  const pane = page.getByRole("complementary", { name: "Task details" });

  await pane.getByRole("button", { name: "Add due date" }).click();
  await page.getByRole("menuitem", { name: "Pick a date" }).click();
  const calendar = page.getByRole("application", { name: /Due date/ });
  await calendar.locator("[slot=next]").click();
  await calendar.getByRole("button", { name: /\b15 / }).click();
  await expect(pane.getByRole("button", { name: /^Due / })).toBeVisible();
  await expect(page.locator("#root")).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );

  await waitForStored<{ dueDate: string | null }>(page, "tasks", (rows) =>
    /^\d{4}-\d{2}-15$/.test(rows[0]?.dueDate ?? ""),
  );
});
