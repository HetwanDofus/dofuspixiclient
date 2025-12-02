import type { SwfReader } from '@/parser/swf-reader.ts';

/**
 * RGB color.
 */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * RGBA color with alpha.
 */
export interface Rgba extends Rgb {
  readonly a: number;
}

/**
 * Read RGB color.
 */
export function readRgb(reader: SwfReader): Rgb {
  return {
    r: reader.readUI8(),
    g: reader.readUI8(),
    b: reader.readUI8(),
  };
}

/**
 * Read RGBA color.
 */
export function readRgba(reader: SwfReader): Rgba {
  return {
    r: reader.readUI8(),
    g: reader.readUI8(),
    b: reader.readUI8(),
    a: reader.readUI8(),
  };
}

/**
 * Read ARGB color (alpha first).
 */
export function readArgb(reader: SwfReader): Rgba {
  const a = reader.readUI8();
  return {
    r: reader.readUI8(),
    g: reader.readUI8(),
    b: reader.readUI8(),
    a,
  };
}

/**
 * Convert to CSS hex color string.
 */
export function toHex(color: Rgb): string {
  const r = color.r.toString(16).padStart(2, '0');
  const g = color.g.toString(16).padStart(2, '0');
  const b = color.b.toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Convert to CSS rgba string.
 */
export function toRgbaString(color: Rgba): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

/**
 * Check if color has transparency (alpha < 255).
 */
export function hasTransparency(color: Rgba): boolean {
  return color.a < 255;
}

/**
 * Get opacity value (0-1) from alpha.
 */
export function getOpacity(color: Rgba): number {
  return color.a / 255;
}

/**
 * Color transform with multiply and add values.
 */
export interface ColorTransform {
  readonly redMultTerm: number;
  readonly greenMultTerm: number;
  readonly blueMultTerm: number;
  readonly alphaMultTerm: number;
  readonly redAddTerm: number;
  readonly greenAddTerm: number;
  readonly blueAddTerm: number;
  readonly alphaAddTerm: number;
}

/**
 * Read color transform without alpha.
 */
export function readColorTransform(reader: SwfReader): ColorTransform {
  const hasAddTerms = reader.readBool();
  const hasMultTerms = reader.readBool();
  const numBits = reader.readUB(4);

  let redMultTerm = 256,
    greenMultTerm = 256,
    blueMultTerm = 256;
  let redAddTerm = 0,
    greenAddTerm = 0,
    blueAddTerm = 0;

  if (hasMultTerms) {
    redMultTerm = reader.readSB(numBits);
    greenMultTerm = reader.readSB(numBits);
    blueMultTerm = reader.readSB(numBits);
  }

  if (hasAddTerms) {
    redAddTerm = reader.readSB(numBits);
    greenAddTerm = reader.readSB(numBits);
    blueAddTerm = reader.readSB(numBits);
  }

  reader.alignByte();

  return {
    redMultTerm,
    greenMultTerm,
    blueMultTerm,
    alphaMultTerm: 256,
    redAddTerm,
    greenAddTerm,
    blueAddTerm,
    alphaAddTerm: 0,
  };
}

/**
 * Read color transform with alpha.
 */
export function readColorTransformWithAlpha(reader: SwfReader): ColorTransform {
  const hasAddTerms = reader.readBool();
  const hasMultTerms = reader.readBool();
  const numBits = reader.readUB(4);

  let redMultTerm = 256,
    greenMultTerm = 256,
    blueMultTerm = 256,
    alphaMultTerm = 256;
  let redAddTerm = 0,
    greenAddTerm = 0,
    blueAddTerm = 0,
    alphaAddTerm = 0;

  if (hasMultTerms) {
    redMultTerm = reader.readSB(numBits);
    greenMultTerm = reader.readSB(numBits);
    blueMultTerm = reader.readSB(numBits);
    alphaMultTerm = reader.readSB(numBits);
  }

  if (hasAddTerms) {
    redAddTerm = reader.readSB(numBits);
    greenAddTerm = reader.readSB(numBits);
    blueAddTerm = reader.readSB(numBits);
    alphaAddTerm = reader.readSB(numBits);
  }

  reader.alignByte();

  return {
    redMultTerm,
    greenMultTerm,
    blueMultTerm,
    alphaMultTerm,
    redAddTerm,
    greenAddTerm,
    blueAddTerm,
    alphaAddTerm,
  };
}

