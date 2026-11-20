import { expect, test } from "@playwright/test";
import { waitForStored } from "./helpers.ts";

test("a custom repeat survives a reload and moves on when ticked off", async ({
  page,
}) => {
  // Thursday 19 November 2026
  await page.clock.setFixedTime(new Date(2026, 10, 19, 12));
  await page.goto("/");
  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill("Bins out");
  await add.press("Enter");
  await page.getByRole("link", { name: "Bins out" }).click();

  const pane = page.getByRole("complementary", { name: "Task details" });
  await pane.getByRole("button", { name: "Repeat" }).click();
  await page.getByRole("menuitem", { name: "Custom" }).click();
  const dialog = page.getByRole("dialog", { name: "Repeat every…" });
  await dialog.getByRole("spinbutton", { name: "Interval" }).fill("2");
  await dialog.getByRole("button", { name: "Monday" }).click();
  await dialog.getByRole("button", { name: "Thursday" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    pane.getByRole("button", { name: "Every 2 weeks" }),
  ).toBeVisible();
  await expect(
    pane.getByRole("button", { name: "Due Mon 23 November" }),
  ).toBeVisible();

  await waitForStored<{ repeat: unknown }>(page, "tasks", (rows) =>
    rows.some((t) => t.repeat !== null),
  );
  await page.reload();
  const open = page.getByRole("list", { name: "Tasks", exact: true });
  await expect(open.getByRole("listitem")).toContainText("repeats");

  await page
    .locator("label", { has: page.getByRole("checkbox", { name: "Bins out" }) })
    .first()
    .click();
  await expect(open.getByRole("link", { name: "Bins out" })).toBeVisible();
  await expect(open.getByRole("listitem")).toContainText("Mon 7 Dec");
  const completed = page.getByRole("list", { name: "Completed tasks" });
  await expect(
    completed.getByRole("checkbox", { name: "Bins out" }),
  ).toBeChecked();
});
