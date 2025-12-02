import type { SwfReader } from '@/parser/swf-reader.ts';

/**
 * JPEG image data (DefineBitsJPEG2).
 */
export interface DefineBitsJpeg2 {
  readonly id: number;
  readonly imageData: Uint8Array;
}

/**
 * JPEG image with alpha channel (DefineBitsJPEG3).
 */
export interface DefineBitsJpeg3 {
  readonly id: number;
  readonly imageData: Uint8Array;
  readonly alphaData: Uint8Array;
}

/**
 * JPEG image with alpha and deblocking (DefineBitsJPEG4).
 */
export interface DefineBitsJpeg4 {
  readonly id: number;
  readonly deblockParam: number;
  readonly imageData: Uint8Array;
  readonly alphaData: Uint8Array;
}

/**
 * Lossless image format.
 */
export const LosslessFormat = {
  ColorMapped8: 3,
  Rgb15: 4,
  Rgb24: 5,
} as const;

export type LosslessFormatValue = (typeof LosslessFormat)[keyof typeof LosslessFormat];

/**
 * Lossless image (DefineBitsLossless).
 */
export interface DefineBitsLossless {
  readonly id: number;
  readonly format: LosslessFormatValue;
  readonly width: number;
  readonly height: number;
  readonly colorTableSize?: number;
  readonly zlibData: Uint8Array;
}

/**
 * Read DefineBitsJPEG2 tag.
 */
export function readDefineBitsJpeg2(reader: SwfReader): DefineBitsJpeg2 {
  const id = reader.readUI16();
  const imageData = reader.readBytesTo(reader.end);

  return { id, imageData };
}

/**
 * Read DefineBitsJPEG3 tag.
 */
export function readDefineBitsJpeg3(reader: SwfReader): DefineBitsJpeg3 {
  const id = reader.readUI16();
  const alphaDataOffset = reader.readUI32();
  const imageData = reader.readBytes(alphaDataOffset);
  const alphaData = reader.readZLibTo(reader.end);

  return { id, imageData, alphaData };
}

/**
 * Read DefineBitsJPEG4 tag.
 */
export function readDefineBitsJpeg4(reader: SwfReader): DefineBitsJpeg4 {
  const id = reader.readUI16();
  const alphaDataOffset = reader.readUI32();
  const deblockParam = reader.readUI16() / 256;
  const imageData = reader.readBytes(alphaDataOffset);
  const alphaData = reader.readZLibTo(reader.end);

  return { id, deblockParam, imageData, alphaData };
}

/**
 * Read DefineBitsLossless tag.
 */
export function readDefineBitsLossless(reader: SwfReader): DefineBitsLossless {
  const id = reader.readUI16();
  const format = reader.readUI8() as LosslessFormatValue;
  const width = reader.readUI16();
  const height = reader.readUI16();

  let colorTableSize: number | undefined;
  if (format === LosslessFormat.ColorMapped8) {
    colorTableSize = reader.readUI8() + 1;
  }

  const zlibData = reader.readBytesTo(reader.end);

  return { id, format, width, height, colorTableSize, zlibData };
}

/**
 * Read DefineBitsLossless2 tag (with alpha).
 */
export function readDefineBitsLossless2(reader: SwfReader): DefineBitsLossless {
  // Same structure as DefineBitsLossless, but colors include alpha
  return readDefineBitsLossless(reader);
}

