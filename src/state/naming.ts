/** "Untitled list", then "Untitled list (1)", "(2)" ... skipping names already taken */
export function uniqueTitle(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})`;
    if (!names.has(candidate)) return candidate;
  }
}
