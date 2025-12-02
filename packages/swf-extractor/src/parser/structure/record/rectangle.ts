import type { SwfReader } from '@/parser/swf-reader.ts';

/**
 * Rectangle record in twips (1/20th of a pixel).
 */
export interface Rectangle {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/**
 * Read a rectangle record from the reader.
 */
export function readRectangle(reader: SwfReader): Rectangle {
  const numBits = reader.readUB(5);
  const xMin = reader.readSB(numBits);
  const xMax = reader.readSB(numBits);
  const yMin = reader.readSB(numBits);
  const yMax = reader.readSB(numBits);
  reader.alignByte();
  return { xMin, xMax, yMin, yMax };
}

/**
 * Convert twips to pixels.
 */
export function twipsToPixels(twips: number): number {
  return twips / 20;
}

/**
 * Get rectangle dimensions in pixels.
 */
export function getRectangleDimensions(rect: Rectangle): { width: number; height: number } {
  return {
    width: twipsToPixels(rect.xMax - rect.xMin),
    height: twipsToPixels(rect.yMax - rect.yMin),
  };
}

