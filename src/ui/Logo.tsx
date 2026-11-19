import type { SVGProps } from "react";
import logo from "../assets/logo.svg?raw";

// The file keeps its own ink colour, here we take only the glyphs so it follows currentColor
const glyphs = [...logo.matchAll(/<path[^>]*\/>/g)].map((m) => m[0]).join("");

type LogoProps = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "dangerouslySetInnerHTML"
> & {
  height?: number;
};

export function Logo({ height = 32, ...rest }: LogoProps) {
  return (
    <svg
      // Tight around the glyphs, the baseline sits at y=0
      viewBox="7.2 -91.32 346.68 118.68"
      height={height}
      fill="currentColor"
      role="img"
      aria-label="Doozly"
      {...rest}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: our own logo file from the bundle
      dangerouslySetInnerHTML={{ __html: glyphs }}
    />
  );
}
