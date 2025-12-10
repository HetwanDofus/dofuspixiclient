import type { SwfReader } from '@/parser/swf-reader.ts';
import { type Rgba, type ColorTransform, readRgb, readRgba } from './color.ts';
import { type Matrix, readMatrix } from './matrix.ts';
import {
  type Gradient,
  type FocalGradient,
  readGradientShape1,
  readGradientShape3,
  readFocalGradient,
} from './gradient.ts';

/**
 * Fill style type constants.
 */
export const FillStyleType = {
  Solid: 0x00,
  LinearGradient: 0x10,
  RadialGradient: 0x12,
  FocalRadialGradient: 0x13,
  RepeatingBitmap: 0x40,
  ClippedBitmap: 0x41,
  NonSmoothedRepeatingBitmap: 0x42,
  NonSmoothedClippedBitmap: 0x43,
} as const;

export type FillStyleTypeValue = (typeof FillStyleType)[keyof typeof FillStyleType];

/**
 * Base fill style interface.
 */
export interface BaseFillStyle {
  readonly type: FillStyleTypeValue;
}

/**
 * Solid color fill.
 */
export interface SolidFill extends BaseFillStyle {
  readonly type: typeof FillStyleType.Solid;
  readonly color: Rgba;
}

/**
 * Gradient fill (linear or radial).
 */
export interface GradientFill extends BaseFillStyle {
  readonly type:
    | typeof FillStyleType.LinearGradient
    | typeof FillStyleType.RadialGradient
    | typeof FillStyleType.FocalRadialGradient;
  readonly matrix: Matrix;
  readonly gradient: Gradient | FocalGradient;
}

/**
 * Bitmap fill.
 */
export interface BitmapFill extends BaseFillStyle {
  readonly type:
    | typeof FillStyleType.RepeatingBitmap
    | typeof FillStyleType.ClippedBitmap
    | typeof FillStyleType.NonSmoothedRepeatingBitmap
    | typeof FillStyleType.NonSmoothedClippedBitmap;
  readonly bitmapId: number;
  readonly matrix: Matrix;
  /**
   * Optional color transformations to apply to the underlying bitmap when
   * rendering. This is filled by the extractor when color transforms are
   * applied to shapes using this fill style.
   */
  readonly colorTransforms?: readonly ColorTransform[];
}

export type FillStyle = SolidFill | GradientFill | BitmapFill;

/**
 * Read fill style for Shape1/2.
 */
export function readFillStyleShape1(reader: SwfReader): FillStyle {
  const type = reader.readUI8() as FillStyleTypeValue;

  if (type === FillStyleType.Solid) {
    return { type, color: { ...readRgb(reader), a: 255 } };
  }

  if (
    type === FillStyleType.LinearGradient ||
    type === FillStyleType.RadialGradient
  ) {
    return {
      type,
      matrix: readMatrix(reader),
      gradient: readGradientShape1(reader),
    };
  }

  if (
    type === FillStyleType.RepeatingBitmap ||
    type === FillStyleType.ClippedBitmap ||
    type === FillStyleType.NonSmoothedRepeatingBitmap ||
    type === FillStyleType.NonSmoothedClippedBitmap
  ) {
    return {
      type,
      bitmapId: reader.readUI16(),
      matrix: readMatrix(reader),
    };
  }

  // Unknown fill type, treat as solid black
  return { type: FillStyleType.Solid, color: { r: 0, g: 0, b: 0, a: 255 } };
}

/**
 * Read fill style for Shape3.
 */
export function readFillStyleShape3(reader: SwfReader): FillStyle {
  const type = reader.readUI8() as FillStyleTypeValue;

  if (type === FillStyleType.Solid) {
    return { type, color: readRgba(reader) };
  }

  if (type === FillStyleType.LinearGradient || type === FillStyleType.RadialGradient) {
    return {
      type,
      matrix: readMatrix(reader),
      gradient: readGradientShape3(reader),
    };
  }

  if (type === FillStyleType.FocalRadialGradient) {
    return {
      type,
      matrix: readMatrix(reader),
      gradient: readFocalGradient(reader),
    };
  }

  if (
    type === FillStyleType.RepeatingBitmap ||
    type === FillStyleType.ClippedBitmap ||
    type === FillStyleType.NonSmoothedRepeatingBitmap ||
    type === FillStyleType.NonSmoothedClippedBitmap
  ) {
    return {
      type,
      bitmapId: reader.readUI16(),
      matrix: readMatrix(reader),
    };
  }

  return { type: FillStyleType.Solid, color: { r: 0, g: 0, b: 0, a: 255 } };
}

/**
 * Read fill style array for Shape1/2.
 */
export function readFillStyleArrayShape1(reader: SwfReader): FillStyle[] {
  let count = reader.readUI8();
  if (count === 0xff) {
    count = reader.readUI16();
  }

  const styles: FillStyle[] = [];
  for (let i = 0; i < count; i++) {
    styles.push(readFillStyleShape1(reader));
  }
  return styles;
}

/**
 * Read fill style array for Shape3/4.
 */
export function readFillStyleArrayShape3(reader: SwfReader): FillStyle[] {
  let count = reader.readUI8();
  if (count === 0xff) {
    count = reader.readUI16();
  }

  const styles: FillStyle[] = [];
  for (let i = 0; i < count; i++) {
    styles.push(readFillStyleShape3(reader));
  }
  return styles;
}

