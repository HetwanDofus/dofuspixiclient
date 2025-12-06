import type { DefineBits, DefineBitsJpeg2, DefineBitsJpeg3, DefineBitsJpeg4, JpegTables } from '@/parser/structure/tag/define-bits.ts';

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
 * Fix JPEG data by removing invalid SOI/EOI markers and adding proper headers.
 * SWF may add multiple SOI, EOI, or has invalid headers.
 * This method removes them and adds proper JPEG header/footer.
 *
 * Matches PHP's GD::fixJpegData() method.
 */
function fixJpegData(imageData: Uint8Array): Uint8Array {
  const len = imageData.length;
  const chunks: Uint8Array[] = [];
  let pos = 0;

  // JPEG markers always start with 0xff, then a byte indicating the marker
  // So find the next marker, and process it until the end of the data
  while (pos < len - 1) {
    // Find next 0xff marker
    let next = -1;
    for (let i = pos; i < len - 1; i++) {
      if (imageData[i] === 0xff) {
        next = i;
        break;
      }
    }

    if (next === -1 || next >= len - 1) {
      // No more markers, copy remaining data
      if (pos < len) {
        chunks.push(imageData.slice(pos));
      }
      break;
    }

    const marker = imageData[next + 1]!;

    // Ignore SOI (0xd8) and EOI (0xd9) markers
    if (marker === 0xd8 || marker === 0xd9) {
      // Copy data before this marker
      if (next > pos) {
        chunks.push(imageData.slice(pos, next));
      }
      pos = next + 2;
      continue;
    }

    // Marker with length: do not change and skip the length
    if (marker !== 0 && (marker < 0xd0 || marker > 0xd7) && next + 3 < len) {
      const length = (imageData[next + 2]! << 8) + imageData[next + 3]!;
      // Copy data from pos to end of this marker segment
      chunks.push(imageData.slice(pos, next + length + 2));
      pos = next + length + 2;
    } else {
      // Marker without length: simply copy it and continue
      chunks.push(imageData.slice(pos, next + 2));
      pos = next + 2;
    }
  }

  // Calculate total length
  let totalLen = 4; // SOI (2) + EOI (2)
  for (const chunk of chunks) {
    totalLen += chunk.length;
  }

  // Build result with proper header and footer
  const result = new Uint8Array(totalLen);
  result[0] = 0xff;
  result[1] = 0xd8; // SOI

  let offset = 2;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  result[offset] = 0xff;
  result[offset + 1] = 0xd9; // EOI

  return result;
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
 * Convert DefineBits to ImageDefinition.
 * DefineBits tags reference a shared JPEGTables tag for encoding tables.
 */
export function extractDefineBits(tag: DefineBits, jpegTables: JpegTables): ImageDefinition {
  // Combine JPEGTables data with the image data
  // The JPEGTables contains the JPEG encoding tables (DQT, DHT, etc.)
  // The DefineBits contains the actual image data (SOF, SOS, etc.)
  const combinedData = new Uint8Array(jpegTables.data.length + tag.imageData.length);
  combinedData.set(jpegTables.data, 0);
  combinedData.set(tag.imageData, jpegTables.data.length);

  const cleanData = fixJpegData(combinedData);
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
 * Convert DefineBitsJPEG2 to ImageDefinition.
 */
export function extractJpeg2(tag: DefineBitsJpeg2): ImageDefinition {
  const cleanData = fixJpegData(tag.imageData);
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
  const cleanData = fixJpegData(tag.imageData);
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
  // JPEG+alpha data is stored with premultiplied alpha, so we need to un-premultiply
  // When alpha is 0, set RGB to 0 as well (like PHP does with setTransparent)
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0, k = 0; i < width * height; i++) {
    const alpha = tag.alphaData[i] ?? 255;
    if (alpha === 0) {
      // Fully transparent - set to transparent black
      rgba[k++] = 0;
      rgba[k++] = 0;
      rgba[k++] = 0;
      rgba[k++] = 0;
      j += 3; // Skip RGB
    } else {
      // Un-premultiply: colors are stored as (color * alpha / 255)
      // We need to reverse this: color = stored * 255 / alpha
      // PHP uses (int) cast which truncates, so we use Math.floor
      const factor = 255 / alpha;
      rgba[k++] = Math.min(255, Math.floor(rgb[j++]! * factor));
      rgba[k++] = Math.min(255, Math.floor(rgb[j++]! * factor));
      rgba[k++] = Math.min(255, Math.floor(rgb[j++]! * factor));
      rgba[k++] = alpha;
    }
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

