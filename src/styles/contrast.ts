/** WCAG relative luminance of a #rrggbb colour */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = (hex.match(/[0-9a-f]{2}/gi) ?? []).map((h) => {
    const v = Number.parseInt(h, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. AA for body text needs 4.5. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
