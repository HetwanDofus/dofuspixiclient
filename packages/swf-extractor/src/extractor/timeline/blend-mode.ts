/**
 * Blend modes for display objects.
 */
export enum BlendMode {
  Normal = 1,
  Layer = 2,
  Multiply = 3,
  Screen = 4,
  Lighten = 5,
  Darken = 6,
  Difference = 7,
  Add = 8,
  Subtract = 9,
  Invert = 10,
  Alpha = 11,
  Erase = 12,
  Overlay = 13,
  Hardlight = 14,
}

/**
 * Convert blend mode to CSS mix-blend-mode value.
 */
export function blendModeToCss(mode: BlendMode): string | null {
  switch (mode) {
    case BlendMode.Multiply:
      return 'multiply';
    case BlendMode.Screen:
      return 'screen';
    case BlendMode.Lighten:
    case BlendMode.Add:
      return 'lighten';
    case BlendMode.Darken:
    case BlendMode.Subtract:
      return 'darken';
    case BlendMode.Difference:
      return 'difference';
    case BlendMode.Overlay:
      return 'overlay';
    case BlendMode.Hardlight:
      return 'hard-light';
    default:
      return null;
  }
}

/**
 * Parse blend mode from number.
 */
export function parseBlendMode(value: number | undefined): BlendMode {
  if (value === undefined || value < 1 || value > 14) {
    return BlendMode.Normal;
  }
  return value as BlendMode;
}

