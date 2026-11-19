import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Logo } from "./Logo.tsx";

test("renders all six letters in currentColor", () => {
  const { container } = render(<Logo />);
  const paths = container.querySelectorAll("svg > path");
  expect(paths).toHaveLength(6);
  for (const p of paths) expect(p).not.toHaveAttribute("fill");
  expect(screen.getByRole("img", { name: "Doozly" })).toBeInTheDocument();
});
