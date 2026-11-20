import { expect, type Locator, type Page, test } from "@playwright/test";
import { waitForStored } from "./helpers.ts";

/** Drags with the mouse in small steps, like a hand would. `hold` waits before moving. */
async function drag(
  page: Page,
  from: Locator,
  to: Locator,
  { dy = 0, hold = 0 }: { dy?: number; hold?: number } = {},
) {
  // Rows still sliding from the last change aren't where they'll be
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          !(a.effect as KeyframeEffect | null)?.target?.closest?.(
            "[data-task-id]",
          ),
      ),
  );
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("not on screen");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, {
    steps: 5,
  });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + dy, {
    steps: 15,
  });
  await page.mouse.up();
}

const addTasks = async (page: Page, titles: string[]) => {
  const add = page.getByRole("textbox", { name: "Add a task" });
  for (const t of titles) {
    await add.fill(t);
    await add.press("Enter");
  }
};

const newList = async (page: Page, title: string) => {
  const input = page
    .getByRole("navigation", { name: "Lists" })
    .getByRole("textbox", { name: "New list" });
  await input.fill(title);
  await input.press("Enter");
};

const taskTitles = (page: Page) =>
  page.getByRole("list", { name: "Tasks" }).getByRole("link");

test("drag a task to a new spot, and it stays there", async ({ page }) => {
  await page.goto("/lists/inbox");
  await addTasks(page, ["One", "Two", "Three"]);
  await expect(taskTitles(page)).toHaveText(["Three", "Two", "One"]);

  await drag(
    page,
    page.getByRole("link", { name: "One" }),
    page.getByRole("link", { name: "Three" }),
    { dy: -10 },
  );
  await expect(taskTitles(page)).toHaveText(["One", "Three", "Two"]);
  // Letting go doesn't open the task
  await expect(page).toHaveURL(/\/lists\/inbox$/);

  await waitForStored<{ title: string; position: string }>(
    page,
    "tasks",
    (rows) => {
      const order = [...rows].sort((x, y) =>
        x.position < y.position ? -1 : 1,
      );
      return order.map((t) => t.title).join() === "One,Three,Two";
    },
  );
  await page.reload();
  await expect(taskTitles(page)).toHaveText(["One", "Three", "Two"]);
});

test("drop a task on a list in the sidebar to move it there", async ({
  page,
}) => {
  await page.goto("/");
  await newList(page, "Groceries");
  await page.getByRole("link", { name: "Tasks" }).click();
  await addTasks(page, ["Milk", "Call mum"]);

  const sidebar = page.getByRole("navigation", { name: "Lists" });
  await drag(
    page,
    page.getByRole("link", { name: "Milk" }),
    sidebar.getByRole("link", { name: "Groceries" }),
  );
  await expect(taskTitles(page)).toHaveText(["Call mum"]);

  await drag(
    page,
    page.getByRole("link", { name: "Call mum" }),
    sidebar.getByRole("link", { name: "Important" }),
  );
  await expect(
    page.getByRole("button", { name: "Important: Call mum" }),
  ).toHaveAttribute("aria-pressed", "true");

  await sidebar.getByRole("link", { name: "Groceries" }).click();
  await expect(taskTitles(page)).toHaveText(["Milk"]);
});

test("drag lists around the sidebar and into a group", async ({ page }) => {
  await page.goto("/");
  await newList(page, "A");
  await newList(page, "B");
  const sidebar = page.getByRole("navigation", { name: "Lists" });
  await sidebar.getByRole("button", { name: "New group" }).click();
  await sidebar.getByRole("textbox", { name: "Group name" }).fill("Home");
  await sidebar.getByRole("textbox", { name: "Group name" }).press("Enter");

  await drag(
    page,
    sidebar.getByRole("link", { name: "B", exact: true }),
    sidebar.getByRole("link", { name: "A", exact: true }),
    { dy: -8 },
  );
  const own = sidebar.getByRole("list").nth(1);
  await expect(own.getByRole("link")).toHaveText(["B", "A"]);

  await drag(
    page,
    sidebar.getByRole("link", { name: "A", exact: true }),
    sidebar.getByRole("button", { name: "Home" }),
  );
  await expect(
    sidebar.getByRole("list", { name: "Home" }).getByRole("link"),
  ).toHaveText(["A"]);
});

test("hold and drag a step to reorder it", async ({ page }) => {
  await page.goto("/lists/inbox");
  await addTasks(page, ["Trip"]);
  await page.getByRole("link", { name: "Trip" }).click();
  const add = page.getByRole("textbox", { name: "Add step" });
  for (const s of ["Pack", "Book", "Go"]) {
    await add.fill(s);
    await add.press("Enter");
  }
  await drag(
    page,
    page.getByRole("textbox", { name: "Step 3" }),
    page.getByRole("textbox", { name: "Step 1" }),
    { dy: -8, hold: 400 },
  );
  await expect(page.getByRole("textbox", { name: "Step 1" })).toHaveValue("Go");
});
