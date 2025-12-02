import type { DefineBitsJpeg2, DefineBitsJpeg3, DefineBitsJpeg4 } from '@/parser/structure/tag/define-bits.ts';

/**
 * Extracted image definition.
 */
export interface ImageDefinition {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
  readonly format: 'jpeg' | 'png';
}

/**
 * JPEG SOI and EOI markers.
 */
const JPEG_SOI = 0xffd8;
const JPEG_EOI = 0xffd9;

/**
 * Find JPEG start of image marker.
 */
function findJpegStart(data: Uint8Array): number {
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === 0xff && data[i + 1] === 0xd8) {
      return i;
    }
  }
  return 0;
}

/**
 * Strip invalid prefix from JPEG data.
 */
function stripJpegPrefix(data: Uint8Array): Uint8Array {
  const start = findJpegStart(data);
  if (start > 0) {
    return data.slice(start);
  }
  return data;
}

/**
 * Get JPEG dimensions from data.
 */
export function getJpegDimensions(data: Uint8Array): { width: number; height: number } {
  // Find SOF0 or SOF2 marker
  for (let i = 0; i < data.length - 8; i++) {
    if (data[i] === 0xff && (data[i + 1] === 0xc0 || data[i + 1] === 0xc2)) {
      const height = (data[i + 5]! << 8) | data[i + 6]!;
      const width = (data[i + 7]! << 8) | data[i + 8]!;
      return { width, height };
    }
  }
  return { width: 0, height: 0 };
}

/**
 * Convert DefineBitsJPEG2 to ImageDefinition.
 */
export function extractJpeg2(tag: DefineBitsJpeg2): ImageDefinition {
  const cleanData = stripJpegPrefix(tag.imageData);
  const { width, height } = getJpegDimensions(cleanData);

  return {
    id: tag.id,
    width,
    height,
    data: Buffer.from(cleanData),
    format: 'jpeg',
  };
}

/**
 * Convert DefineBitsJPEG3 to ImageDefinition (with alpha).
 * Returns PNG since JPEG doesn't support alpha.
 */
export async function extractJpeg3(tag: DefineBitsJpeg3): Promise<ImageDefinition> {
  const cleanData = stripJpegPrefix(tag.imageData);
  const { width, height } = getJpegDimensions(cleanData);

  // If no alpha data, return as JPEG
  if (tag.alphaData.length === 0) {
    return {
      id: tag.id,
      width,
      height,
      data: Buffer.from(cleanData),
      format: 'jpeg',
    };
  }

  // Combine JPEG with alpha channel using sharp
  const sharp = (await import('sharp')).default;

  const jpegBuffer = Buffer.from(cleanData);
  const rgb = await sharp(jpegBuffer).raw().toBuffer();

  // Create RGBA buffer
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0, k = 0; i < width * height; i++) {
    rgba[k++] = rgb[j++]!;
    rgba[k++] = rgb[j++]!;
    rgba[k++] = rgb[j++]!;
    rgba[k++] = tag.alphaData[i] ?? 255;
  }

  const pngBuffer = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  return {
    id: tag.id,
    width,
    height,
    data: pngBuffer,
    format: 'png',
  };
}

/**
 * Convert DefineBitsJPEG4 to ImageDefinition.
 */
export async function extractJpeg4(tag: DefineBitsJpeg4): Promise<ImageDefinition> {
  // Same as JPEG3 for our purposes
  return extractJpeg3({
    id: tag.id,
    imageData: tag.imageData,
    alphaData: tag.alphaData,
  });
}

