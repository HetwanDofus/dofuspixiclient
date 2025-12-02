import type { SwfReader } from '@/parser/swf-reader.ts';
import { type Rgba, readRgb, readRgba } from './color.ts';

/**
 * Gradient spread mode.
 */
export const SpreadMode = {
  Pad: 0,
  Reflect: 1,
  Repeat: 2,
} as const;

export type SpreadModeValue = (typeof SpreadMode)[keyof typeof SpreadMode];

/**
 * Gradient interpolation mode.
 */
export const InterpolationMode = {
  Normal: 0,
  Linear: 1,
} as const;

export type InterpolationModeValue = (typeof InterpolationMode)[keyof typeof InterpolationMode];

/**
 * A single gradient stop.
 */
export interface GradientRecord {
  /** Position in the gradient (0-255) */
  readonly ratio: number;
  /** Color at this position */
  readonly color: Rgba;
}

/**
 * Gradient definition.
 */
export interface Gradient {
  readonly spreadMode: SpreadModeValue;
  readonly interpolationMode: InterpolationModeValue;
  readonly records: readonly GradientRecord[];
}

/**
 * Focal gradient definition (radial with focal point).
 */
export interface FocalGradient extends Gradient {
  readonly focalPoint: number;
}

/**
 * Read gradient record for Shape1/2.
 */
export function readGradientRecordShape1(reader: SwfReader): GradientRecord {
  return {
    ratio: reader.readUI8(),
    color: { ...readRgb(reader), a: 255 },
  };
}

/**
 * Read gradient record for Shape3/4.
 */
export function readGradientRecordShape3(reader: SwfReader): GradientRecord {
  return {
    ratio: reader.readUI8(),
    color: readRgba(reader),
  };
}

/**
 * Read gradient for Shape1/2.
 */
export function readGradientShape1(reader: SwfReader): Gradient {
  const flags = reader.readUI8();
  const spreadMode = ((flags >> 4) & 0x3) as SpreadModeValue;
  const interpolationMode = ((flags >> 2) & 0x3) as InterpolationModeValue;
  const numGradients = flags & 0xf;

  const records: GradientRecord[] = [];
  for (let i = 0; i < numGradients; i++) {
    records.push(readGradientRecordShape1(reader));
  }

  return { spreadMode, interpolationMode, records };
}

/**
 * Read gradient for Shape3/4.
 */
export function readGradientShape3(reader: SwfReader): Gradient {
  const flags = reader.readUI8();
  const spreadMode = ((flags >> 4) & 0x3) as SpreadModeValue;
  const interpolationMode = ((flags >> 2) & 0x3) as InterpolationModeValue;
  const numGradients = flags & 0xf;

  const records: GradientRecord[] = [];
  for (let i = 0; i < numGradients; i++) {
    records.push(readGradientRecordShape3(reader));
  }

  return { spreadMode, interpolationMode, records };
}

/**
 * Read focal gradient for Shape4.
 */
export function readFocalGradient(reader: SwfReader): FocalGradient {
  const gradient = readGradientShape3(reader);
  const focalPoint = reader.readFixed8();

  return { ...gradient, focalPoint };
}

