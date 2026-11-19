// Keep in sync with the [data-accent] rules in tokens.css. In hue order, like the picker shows them.
export const accents = [
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "pink",
  "rose",
  "red",
  "orange",
  "amber",
  "brown",
  "olive",
  "green",
  "slate",
] as const;

export type Accent = (typeof accents)[number];

export const defaultAccent: Accent = "teal";
