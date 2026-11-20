// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { cspDirectives } from "./headers.ts";

test("the desktop app has the same CSP as the web app", () => {
  const conf = JSON.parse(
    readFileSync(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );
  // Release builds talk to the production relay
  const web = Object.fromEntries(
    Object.entries(cspDirectives("https://api.doozly.app")).map(
      ([name, values]) => [name, values.join(" ")],
    ),
  );
  expect(conf.app.security.csp).toEqual(web);
});
