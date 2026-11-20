import { test as base, expect } from "@playwright/test";

export type { Locator, Page } from "@playwright/test";
export { expect };

// Every test fails when the page breaks the CSP, so a new script, style or host can't slip by
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ page }, use) => {
      const seen: string[] = [];
      await page.exposeFunction("__cspViolation", (v: string) => seen.push(v));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          const report = (window as unknown as Record<string, unknown>)
            .__cspViolation as (v: string) => void;
          report(
            `${e.effectiveDirective} ${e.blockedURI} from ${e.sourceFile}:${e.lineNumber}`,
          );
        });
      });
      await use(seen);
      // GIS styles its own sign-in button inline. We don't use that button, so it may stay blocked.
      const gisButton =
        /^style-src-elem inline from https:\/\/accounts\.google\.com\/gsi\//;
      expect(
        seen.filter((v) => !gisButton.test(v)),
        "CSP violations",
      ).toEqual([]);
    },
    { auto: true },
  ],
});
