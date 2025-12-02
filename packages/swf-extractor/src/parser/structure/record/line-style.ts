import type { SwfReader } from '@/parser/swf-reader.ts';
import { type Rgba, readRgb, readRgba } from './color.ts';
import { type FillStyle, readFillStyleShape3 } from './fill-style.ts';

/**
 * Cap style for line endings.
 */
export const CapStyle = {
  Round: 0,
  None: 1,
  Square: 2,
} as const;

export type CapStyleValue = (typeof CapStyle)[keyof typeof CapStyle];

/**
 * Join style for line corners.
 */
export const JoinStyle = {
  Round: 0,
  Bevel: 1,
  Miter: 2,
} as const;

export type JoinStyleValue = (typeof JoinStyle)[keyof typeof JoinStyle];

/**
 * Line style for Shape1/2/3.
 */
export interface LineStyle {
  readonly width: number;
  readonly color: Rgba;
}

/**
 * Extended line style for Shape4.
 */
export interface LineStyle2 {
  readonly width: number;
  readonly startCapStyle: CapStyleValue;
  readonly joinStyle: JoinStyleValue;
  readonly hasFill: boolean;
  readonly noHScale: boolean;
  readonly noVScale: boolean;
  readonly pixelHinting: boolean;
  readonly noClose: boolean;
  readonly endCapStyle: CapStyleValue;
  readonly miterLimitFactor?: number;
  readonly color?: Rgba;
  readonly fillType?: FillStyle;
}

/**
 * Read line style for Shape1/2.
 */
export function readLineStyleShape1(reader: SwfReader): LineStyle {
  return {
    width: reader.readUI16(),
    color: { ...readRgb(reader), a: 255 },
  };
}

/**
 * Read line style for Shape3.
 */
export function readLineStyleShape3(reader: SwfReader): LineStyle {
  return {
    width: reader.readUI16(),
    color: readRgba(reader),
  };
}

/**
 * Read extended line style for Shape4.
 */
export function readLineStyle2(reader: SwfReader): LineStyle2 {
  const width = reader.readUI16();

  const startCapStyle = reader.readUB(2) as CapStyleValue;
  const joinStyle = reader.readUB(2) as JoinStyleValue;
  const hasFill = reader.readBool();
  const noHScale = reader.readBool();
  const noVScale = reader.readBool();
  const pixelHinting = reader.readBool();
  reader.readUB(5); // Reserved
  const noClose = reader.readBool();
  const endCapStyle = reader.readUB(2) as CapStyleValue;

  let miterLimitFactor: number | undefined;
  if (joinStyle === JoinStyle.Miter) {
    miterLimitFactor = reader.readFixed8();
  }

  let color: Rgba | undefined;
  let fillType: FillStyle | undefined;

  if (hasFill) {
    fillType = readFillStyleShape3(reader);
  } else {
    color = readRgba(reader);
  }

  return {
    width,
    startCapStyle,
    joinStyle,
    hasFill,
    noHScale,
    noVScale,
    pixelHinting,
    noClose,
    endCapStyle,
    miterLimitFactor,
    color,
    fillType,
  };
}

/**
 * Read line style array for Shape1/2.
 */
export function readLineStyleArrayShape1(reader: SwfReader): LineStyle[] {
  let count = reader.readUI8();
  if (count === 0xff) {
    count = reader.readUI16();
  }

  const styles: LineStyle[] = [];
  for (let i = 0; i < count; i++) {
    styles.push(readLineStyleShape1(reader));
  }
  return styles;
}

/**
 * Read line style array for Shape3.
 */
export function readLineStyleArrayShape3(reader: SwfReader): LineStyle[] {
  let count = reader.readUI8();
  if (count === 0xff) {
    count = reader.readUI16();
  }

  const styles: LineStyle[] = [];
  for (let i = 0; i < count; i++) {
    styles.push(readLineStyleShape3(reader));
  }
  return styles;
}

/**
 * Read line style 2 array for Shape4.
 */
export function readLineStyle2Array(reader: SwfReader): LineStyle2[] {
  let count = reader.readUI8();
  if (count === 0xff) {
    count = reader.readUI16();
  }

  const styles: LineStyle2[] = [];
  for (let i = 0; i < count; i++) {
    styles.push(readLineStyle2(reader));
  }
  return styles;
}

