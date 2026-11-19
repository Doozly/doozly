// Keep in sync with the [data-accent] rules in tokens.css
export const accents = [
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
  "red",
  "orange",
  "amber",
  "green",
  "slate",
] as const;

export type Accent = (typeof accents)[number];

export const defaultAccent: Accent = "teal";
