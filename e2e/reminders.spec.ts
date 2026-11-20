import { expect, test } from "./fixtures.ts";
import { waitForStored } from "./helpers.ts";

test("a reminder set for later today shows up when it's time", async ({
  page,
}) => {
  // No system notifications here, also it has to show inside the app
  await page.addInitScript(() => {
    delete (window as { Notification?: unknown }).Notification;
  });
  // Thursday 19 November 2026, just before noon. The clock runs on from here,
  // so Later today is 15:00 for the next two minutes.
  await page.clock.install({ time: new Date(2026, 10, 19, 11, 58) });
  await page.goto("/lists/inbox");
  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill("Call the dentist");
  await add.press("Enter");
  await page.getByRole("link", { name: "Call the dentist" }).click();

  const pane = page.getByRole("complementary", { name: "Task details" });
  await pane.getByRole("button", { name: "Remind me" }).click();
  await page.getByRole("menuitem", { name: /^Later today/ }).click();
  await expect(
    pane.getByRole("button", { name: "Remind me at 15:00, Today" }),
  ).toBeVisible();
  await expect(pane.getByText(/Notifications are blocked/)).toBeVisible();

  await waitForStored<{ reminderAt: number | null }>(page, "tasks", (rows) =>
    rows.some((t) => t.reminderAt !== null),
  );
  await page.reload();
  const row = page
    .getByRole("list", { name: "Tasks", exact: true })
    .getByRole("listitem");
  await expect(row).toContainText("Today, 15:00");
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.clock.fastForward("03:05:00");
  const card = page.getByRole("alert");
  await expect(card).toContainText("Call the dentist");
  await card.getByRole("button", { name: "Open" }).click();
  await expect(card).toBeHidden();
  await expect(
    page
      .getByRole("complementary", { name: "Task details" })
      .getByRole("textbox", { name: "Task title" }),
  ).toHaveValue("Call the dentist");
});
