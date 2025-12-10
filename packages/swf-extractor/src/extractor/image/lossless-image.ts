import { inflateSync } from 'node:zlib';
import type { DefineBitsLossless } from '@/parser/structure/tag/define-bits.ts';
import { LosslessFormat } from '@/parser/structure/tag/define-bits.ts';
import type { ImageDefinition } from './image-definition.ts';
import { encodePng } from './png-encoder.ts';

/**
 * Extract lossless image (DefineBitsLossless/DefineBitsLossless2).
 * @param tag - The lossless image tag
 * @param hasAlpha - True for DefineBitsLossless2
 */
export async function extractLossless(
  tag: DefineBitsLossless,
  hasAlpha: boolean,
): Promise<ImageDefinition> {
  // Decompress zlib data
  const decompressed = inflateSync(tag.zlibData);

  const { width, height, format, colorTableSize } = tag;
  let rgba: Uint8Array;

  switch (format) {
    case LosslessFormat.ColorMapped8:
      rgba = decodeColorMapped8(decompressed, width, height, colorTableSize ?? 0, hasAlpha);
      break;

    case LosslessFormat.Rgb15:
      rgba = decodeRgb15(decompressed, width, height);
      break;

    case LosslessFormat.Rgb24:
      rgba = hasAlpha
        ? decodeArgb32(decompressed, width, height)
        : decodeRgb24(decompressed, width, height);
        
      break;

    default:
      throw new Error(`Unknown lossless format: ${format}`);
  }

  const rgbaBuffer = Buffer.from(rgba);
  const pngBuffer = encodePng(width, height, rgbaBuffer);

  return {
    id: tag.id,
    width,
    height,
    data: pngBuffer,
    format: 'png',
    rgba: rgbaBuffer,
  };
}

/**
 * Decode color-mapped 8-bit image.
 */
function decodeColorMapped8(
  data: Uint8Array,
  width: number,
  height: number,
  colorTableSize: number,
  hasAlpha: boolean,
): Uint8Array {
  const bytesPerColor = hasAlpha ? 4 : 3;
  const colorTable = data.slice(0, colorTableSize * bytesPerColor);
  const rowPadding = (4 - (width % 4)) % 4;
  const rgba = new Uint8Array(width * height * 4);

  let srcOffset = colorTableSize * bytesPerColor;
  let dstOffset = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = data[srcOffset++]!;
      const colorOffset = idx * bytesPerColor;

      if (hasAlpha) {
        // RGBA format in color table (per SWF spec)
        rgba[dstOffset++] = colorTable[colorOffset]!; // R
        rgba[dstOffset++] = colorTable[colorOffset + 1]!; // G
        rgba[dstOffset++] = colorTable[colorOffset + 2]!; // B
        rgba[dstOffset++] = colorTable[colorOffset + 3]!; // A
      } else {
        rgba[dstOffset++] = colorTable[colorOffset]!; // R
        rgba[dstOffset++] = colorTable[colorOffset + 1]!; // G
        rgba[dstOffset++] = colorTable[colorOffset + 2]!; // B
        rgba[dstOffset++] = 255; // A
      }
    }
    srcOffset += rowPadding;
  }

  return rgba;
}

/**
 * Decode RGB15 (5-5-5) image.
 */
function decodeRgb15(data: Uint8Array, width: number, height: number): Uint8Array {
  const rowPadding = (4 - ((width * 2) % 4)) % 4;
  const rgba = new Uint8Array(width * height * 4);

  let srcOffset = 0;
  let dstOffset = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = (data[srcOffset]! << 8) | data[srcOffset + 1]!;
      srcOffset += 2;

      rgba[dstOffset++] = ((pixel >> 10) & 0x1f) << 3; // R
      rgba[dstOffset++] = ((pixel >> 5) & 0x1f) << 3; // G
      rgba[dstOffset++] = (pixel & 0x1f) << 3; // B
      rgba[dstOffset++] = 255; // A
    }
    srcOffset += rowPadding;
  }

  return rgba;
}

/**
 * Decode RGB24 image.
 */
function decodeRgb24(data: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);

  let srcOffset = 0;
  let dstOffset = 0;

  for (let i = 0; i < width * height; i++) {
    srcOffset++; // Skip padding byte (XRGB)
    rgba[dstOffset++] = data[srcOffset++]!; // R
    rgba[dstOffset++] = data[srcOffset++]!; // G
    rgba[dstOffset++] = data[srcOffset++]!; // B
    rgba[dstOffset++] = 255; // A
  }

  return rgba;
}

/**
 * Decode ARGB32 image.
 * SWF stores ARGB32 with premultiplied alpha, so we need to un-premultiply.
 */
function decodeArgb32(data: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);

  let srcOffset = 0;
  let dstOffset = 0;

  for (let i = 0; i < width * height; i++) {
    const a = data[srcOffset++]!;

    if (a === 0) {
      // Fully transparent - color is undefined, use transparent black
      rgba[dstOffset++] = 0; // R
      rgba[dstOffset++] = 0; // G
      rgba[dstOffset++] = 0; // B
      rgba[dstOffset++] = 0; // A
      srcOffset += 3; // Skip RGB
    } else {
      // Un-premultiply: colors are stored as (color * alpha / 255)
      // We need to reverse this: color = stored * 255 / alpha
      // PHP uses (int) cast which truncates, so we use Math.floor
      const factor = 255 / a;
      rgba[dstOffset++] = Math.min(255, Math.floor(data[srcOffset++]! * factor)); // R
      rgba[dstOffset++] = Math.min(255, Math.floor(data[srcOffset++]! * factor)); // G
      rgba[dstOffset++] = Math.min(255, Math.floor(data[srcOffset++]! * factor)); // B
      rgba[dstOffset++] = a; // A
    }
  }

  return rgba;
}

