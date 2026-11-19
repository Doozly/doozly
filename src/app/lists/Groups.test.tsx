import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { renderApp } from "../../test/render.tsx";
import { useUi } from "../uiStore.ts";

beforeEach(() => {
  useUi.setState({
    sidebarCollapsed: false,
    drawerOpen: false,
    completedFolded: {},
    renamingListId: null,
    groupsFolded: {},
    renamingGroupId: null,
  });
});

const sidebar = () => screen.getByRole("navigation", { name: "Lists" });

async function menu(target: HTMLElement, item: string) {
  fireEvent.contextMenu(target);
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

test("New group starts as Untitled group, ready to be named", async () => {
  await renderApp();
  await userEvent.click(screen.getByRole("button", { name: "New group" }));
  const name = screen.getByRole("textbox", { name: "Group name" });
  expect(name).toHaveValue("Untitled group");
  expect(name).toHaveFocus();
  // The name is selected already, typing replaces it
  await userEvent.keyboard("Home{Enter}");
  expect(
    within(sidebar()).getByRole("button", { name: "Home" }),
  ).toHaveAttribute("aria-expanded", "true");
});

test("a list moves into a group from its menu, and out again", async () => {
  await renderApp("/", (a) => {
    a.addList("Groceries");
    a.addGroup("Home");
  });
  await menu(
    within(sidebar()).getByRole("link", { name: "Groceries" }),
    "Move to Home",
  );
  const home = within(sidebar()).getByRole("list", { name: "Home" });
  expect(within(home).getByRole("link", { name: "Groceries" })).toBeVisible();

  await menu(
    within(home).getByRole("link", { name: "Groceries" }),
    "Remove from group",
  );
  expect(
    within(within(sidebar()).getByRole("list", { name: "Home" })).queryByRole(
      "link",
    ),
  ).toBeNull();
});

test("a group folds its lists away", async () => {
  await renderApp("/", (a) => {
    const g = a.addGroup("Home");
    const l = a.addList("Groceries");
    a.moveListToGroup(l.id, g.id);
  });
  const header = within(sidebar()).getByRole("button", { name: "Home" });
  await userEvent.click(header);
  expect(header).toHaveAttribute("aria-expanded", "false");
  expect(
    within(sidebar()).queryByRole("link", { name: "Groceries" }),
  ).toBeNull();
  await userEvent.click(header);
  expect(
    within(sidebar()).getByRole("link", { name: "Groceries" }),
  ).toBeVisible();
});

test("Ungroup lists brings them back and removes the group", async () => {
  await renderApp("/", (a) => {
    const g = a.addGroup("Home");
    const l = a.addList("Groceries");
    a.moveListToGroup(l.id, g.id);
  });
  await menu(
    within(sidebar()).getByRole("button", { name: "Home" }),
    "Ungroup lists",
  );
  expect(within(sidebar()).queryByRole("button", { name: "Home" })).toBeNull();
  expect(
    within(sidebar()).getByRole("link", { name: "Groceries" }),
  ).toBeVisible();
});

test("an empty group can be deleted and renamed from its menu", async () => {
  await renderApp("/", (a) => a.addGroup("Home"));
  await menu(
    within(sidebar()).getByRole("button", { name: "Home" }),
    "Rename group",
  );
  const name = screen.getByRole("textbox", { name: "Group name" });
  await userEvent.clear(name);
  await userEvent.type(name, "House{Enter}");
  const header = within(sidebar()).getByRole("button", { name: "House" });

  await menu(header, "Delete group");
  expect(within(sidebar()).queryByRole("button", { name: "House" })).toBeNull();
});
