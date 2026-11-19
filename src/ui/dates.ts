const DAY = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "today", "yesterday", or "on Wed 18 November" (with the year when it isn't this one) */
export function relativeDay(ms: number, now = Date.now()): string {
  // Rounding copes with the 23 and 25 hour days around clock changes
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  const formatted = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  })
    .format(ms)
    .replace(",", "");
  return `on ${formatted}`;
}
