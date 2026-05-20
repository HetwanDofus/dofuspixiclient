import type { LabelStyle } from "./types.ts";

// FLA label `styleName` values follow `<Color><Align><Size>Label` patterns
// defined by the project's AS3 stylesheets (DefaultStylePackage /
// CustomStylePackage). Source not in this repo — values below are reconstructed
// from project memory and verified visually against extracted SVG renderings.
// Extend as new style names appear in the FLA library.

const COLOR_MAP: Record<string, string> = {
  White: "#ffffff",
  Black: "#000000",
  Brown: "#514a3c",
  Orange: "#ff6100",
  Red: "#c10000",
  Green: "#009900",
  Blue: "#0066ff",
  Yellow: "#ffff00",
  Gold: "#ffaa00",
  Tan: "#d5cfaa",
};

const SIZE_MAP: Record<string, number> = {
  Small: 10,
  Medium: 12,
  Big: 14,
  Large: 14,
  Huge: 18,
};

const ALIGN_MAP: Record<string, "left" | "center" | "right"> = {
  Left: "left",
  Center: "center",
  Right: "right",
};

// Explicit overrides win over pattern resolution. Add entries here when the
// regex falls back to defaults that don't match the original game's pixels.
const OVERRIDES: Record<string, LabelStyle> = {};

const PATTERN =
  /^(White|Black|Brown|Orange|Red|Green|Blue|Yellow|Gold|Tan)?(Left|Center|Right)?(Small|Medium|Big|Large|Huge)?(Bold)?(Italic)?Label$/;

export function resolveStyleNameToLabelStyle(
  styleName: string,
): LabelStyle | undefined {
  if (OVERRIDES[styleName]) return OVERRIDES[styleName];

  const m = PATTERN.exec(styleName);
  if (!m) return undefined;

  const [, color, align, size, bold, italic] = m;
  return {
    face: "Verdana",
    size: size ? SIZE_MAP[size] : 10,
    color: color ? COLOR_MAP[color] : "#000000",
    align: align ? ALIGN_MAP[align] : "left",
    bold: bold === "Bold" || undefined,
    italic: italic === "Italic" || undefined,
  };
}

export function collectLabelStyles(
  encountered: Iterable<string>,
): Record<string, LabelStyle> {
  const result: Record<string, LabelStyle> = {};
  for (const name of encountered) {
    if (result[name]) continue;
    const style = resolveStyleNameToLabelStyle(name);
    if (style) result[name] = style;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}
