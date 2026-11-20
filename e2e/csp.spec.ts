import { expect, test } from "./fixtures.ts";

test("the app is served with a strict CSP", async ({ page }) => {
  const res = await page.goto("/lists/inbox");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
  expect(res?.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
});

test("inline scripts and other hosts are refused", async ({
  page,
  cspViolations,
}) => {
  await page.goto("/lists/inbox");
  const ran = await page.evaluate(async () => {
    const script = document.createElement("script");
    script.textContent = "window.__ran = true";
    document.body.append(script);
    await fetch("https://example.com/").catch(() => {});
    return "__ran" in window;
  });
  expect(ran).toBe(false);
  await expect
    .poll(() => cspViolations.map((v) => v.split(" ")[0]))
    .toEqual(expect.arrayContaining(["script-src-elem", "connect-src"]));
  // Wanted here, so the fixture mustn't fail the test for them
  cspViolations.length = 0;
});
