// Keep in sync with the [data-background] rules in backgrounds.css
export const backgrounds = [
  "aurora",
  "dusk",
  "forest",
  "ocean",
  "ember",
  "night",
  "blueprint",
  "dunes",
] as const;

export type Background = (typeof backgrounds)[number];

export const backgroundLabels: Record<Background, string> = {
  aurora: "Aurora",
  dusk: "Dusk",
  forest: "Forest",
  ocean: "Ocean",
  ember: "Ember",
  night: "Night sky",
  blueprint: "Blueprint",
  dunes: "Dunes",
};
