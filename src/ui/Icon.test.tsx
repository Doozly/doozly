import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Icon, iconNames } from "./Icon.tsx";

test.each(iconNames)("%s renders its SVG shapes", (name) => {
  const { container } = render(<Icon name={name} />);
  const svg = container.querySelector("svg");
  expect(svg?.children.length).toBeGreaterThan(0);
  expect(svg?.querySelector("svg")).toBeNull();
});

test("is hidden from screen readers without a label", () => {
  const { container } = render(<Icon name="add" />);
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

test("is an image with a label", () => {
  render(<Icon name="important" label="Important" />);
  expect(screen.getByRole("img", { name: "Important" })).toBeInTheDocument();
});

test("filled swaps the shape when there is a filled version", () => {
  const outline = render(<Icon name="important" />).container.innerHTML;
  const solid = render(<Icon name="important" filled />).container.innerHTML;
  expect(solid).not.toBe(outline);
});

test("filled falls back to the outline when there isn't one", () => {
  const outline = render(<Icon name="add" />).container.innerHTML;
  const solid = render(<Icon name="add" filled />).container.innerHTML;
  expect(solid).toBe(outline);
});
