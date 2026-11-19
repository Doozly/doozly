import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { INBOX_ID } from "../../data/model.ts";
import type { Actions } from "../../state/actions.ts";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

beforeEach(() => {
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    completedFolded: {},
    renamingListId: null,
  });
});

const seed = (a: Actions) => {
  a.setSetting("addNewTasksOnTop", false);
  a.addTask(INBOX_ID, "Bread");
  a.addTask(INBOX_ID, "apples", { important: true });
  a.addTask(INBOX_ID, "Cheese", { dueDate: "2030-01-01" });
};

const titles = (name = "Tasks") =>
  within(screen.getByRole("list", { name }))
    .getAllByRole("link")
    .map((l) => l.textContent);

async function choose(menu: "Sort" | "Group", item: string) {
  await userEvent.click(screen.getByRole("button", { name: menu }));
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
}

test("sort alphabetically, reverse it, then drop it again", async () => {
  const { state } = await renderApp("/lists/inbox", seed);
  // "Move starred to top" is on by default
  expect(titles()).toEqual(["apples", "Bread", "Cheese"]);

  await choose("Sort", "Alphabetically");
  expect(screen.getByText("Sorted alphabetically")).toBeVisible();
  expect(state().lists[INBOX_ID]?.sort).toEqual({
    by: "title",
    direction: "asc",
  });

  await userEvent.click(
    screen.getByRole("button", { name: "Reverse sort order" }),
  );
  expect(titles()).toEqual(["Cheese", "Bread", "apples"]);

  await userEvent.click(
    screen.getByRole("button", { name: "Remove sort order option" }),
  );
  expect(screen.queryByText("Sorted alphabetically")).toBeNull();
  expect(state().lists[INBOX_ID]?.sort).toBeNull();
  expect(titles()).toEqual(["apples", "Bread", "Cheese"]);
});

test("a sort overrides starred on top", async () => {
  await renderApp("/lists/inbox", seed);
  await choose("Sort", "Due date");
  expect(titles()).toEqual(["Cheese", "Bread", "apples"]);
});

test("group by importance puts headings over the tasks, per list", async () => {
  const { state } = await renderApp("/lists/inbox", (a) => {
    seed(a);
    a.addList("Other");
  });
  await choose("Group", "Importance");

  expect(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
  ).toEqual(["Important", "Not important"]);
  expect(titles("Important")).toEqual(["apples"]);
  expect(titles("Not important")).toEqual(["Bread", "Cheese"]);
  expect(state().lists[INBOX_ID]?.group).toBe("importance");

  const other = Object.values(state().lists).find((l) => l.title === "Other");
  expect(other?.group).toBeNull();

  await userEvent.click(
    screen.getByRole("button", { name: "Remove group by option" }),
  );
  expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
});
