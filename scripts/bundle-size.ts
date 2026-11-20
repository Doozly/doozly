import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

// Gzipped JS that index.html loads before the first paint. Lazy chunks don't count.
// Raising it is a decision: write down why in docs/architecture.md.
const BUDGET_KB = 200;

const dist = new URL("../dist/", import.meta.url);
const html = readFileSync(new URL("index.html", dist), "utf8");
const scripts = [
  ...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\/?([^"]+\.js)"/g),
]
  .map((m) => m[1])
  .filter((f): f is string => Boolean(f));

let total = 0;
for (const file of scripts) {
  const kb = gzipSync(readFileSync(new URL(file, dist))).length / 1000;
  total += kb;
  console.log(`${kb.toFixed(1).padStart(7)} kB  ${file}`);
}
console.log(
  `${total.toFixed(1).padStart(7)} kB  first load, budget ${BUDGET_KB} kB`,
);

if (scripts.length === 0) {
  console.error("No scripts found in dist/index.html, run pnpm build first");
  process.exit(1);
}
if (total > BUDGET_KB) {
  console.error(`Over the budget by ${(total - BUDGET_KB).toFixed(1)} kB`);
  process.exit(1);
}
