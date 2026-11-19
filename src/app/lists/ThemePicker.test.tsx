import { screen } from "@testing-library/react";
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
  });
});

const pane = () =>
  screen
    .getByRole("heading", { level: 1, hidden: true })
    .closest("[data-accent]");

test("pick a colour and a background from the list options", async () => {
  const { state } = await renderApp("/lists/inbox", (a) =>
    a.addList("Holiday"),
  );
  await userEvent.click(screen.getByRole("link", { name: "Holiday" }));
  await userEvent.click(screen.getByRole("button", { name: "List options" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Change theme" }),
  );

  const dialog = await screen.findByRole("dialog", {
    name: "Theme for Holiday",
  });
  expect(dialog).toBeVisible();
  const colours = screen
    .getAllByRole("radio")
    .filter((r) => r.closest('[aria-label="Colour"]'));
  expect(colours).toHaveLength(16);
  expect(screen.getByRole("radio", { name: "Teal" })).toBeChecked();

  await userEvent.click(screen.getByRole("radio", { name: "Rose" }));
  expect(pane()).toHaveAttribute("data-accent", "rose");

  await userEvent.click(screen.getByRole("radio", { name: "Ocean" }));
  expect(pane()).toHaveAttribute("data-background", "ocean");
  const list = Object.values(state().lists).find((l) => l.title === "Holiday");
  expect(list).toMatchObject({ accent: "rose", background: "ocean" });

  await userEvent.click(screen.getByRole("radio", { name: "No background" }));
  expect(pane()).not.toHaveAttribute("data-background");

  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  // The sidebar icon takes the colour too
  expect(screen.getByRole("link", { name: "Holiday" })).toHaveAttribute(
    "data-accent",
    "rose",
  );
});
