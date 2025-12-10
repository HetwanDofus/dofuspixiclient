import type { DefineBits, DefineBitsJpeg2, DefineBitsJpeg3, DefineBitsJpeg4, JpegTables } from '@/parser/structure/tag/define-bits.ts';
import { encodePng } from './png-encoder.ts';

/**
 * Extracted image definition.
 */
export interface ImageDefinition {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
  readonly format: 'jpeg' | 'png';
  /** Optional raw RGBA data used for color transforms. */
  readonly rgba?: Buffer;
  /** Whether the original tag had alpha data (for JPEG3/JPEG4 tags). */
  readonly hasAlpha?: boolean;
}

type ImageDataType = 'jpeg' | 'png' | 'gif89a';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF89A_SIGNATURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"

function startsWithBytes(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Resolve the image data type from the image header.
 * Mirrors PHP ImageDataType::resolve().
 */
function resolveImageDataType(imageData: Uint8Array): ImageDataType {
  if (startsWithBytes(imageData, PNG_SIGNATURE)) return 'png';
  if (startsWithBytes(imageData, GIF89A_SIGNATURE)) return 'gif89a';
  return 'jpeg';
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
      // No more markers
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
 * Get PNG dimensions from data (IHDR width/height).
 */
function getPngDimensions(data: Uint8Array): { width: number; height: number } {
  if (!startsWithBytes(data, PNG_SIGNATURE) || data.length < 24) {
    return { width: 0, height: 0 };
  }

  // PNG layout:
  //  0..7   signature
  //  8..11  IHDR length (ignored)
  // 12..15  "IHDR"
  // 16..19  width (big-endian)
  // 20..23  height (big-endian)
  const width =
    data[16]! * 2 ** 24 +
    data[17]! * 2 ** 16 +
    data[18]! * 2 ** 8 +
    data[19]!;
  const height =
    data[20]! * 2 ** 24 +
    data[21]! * 2 ** 16 +
    data[22]! * 2 ** 8 +
    data[23]!;

  return { width, height };
}

/**
 * Convert DefineBits to ImageDefinition.
 * DefineBits tags reference a shared JPEGTables tag for encoding tables.
 */
export async function extractDefineBits(tag: DefineBits, jpegTables: JpegTables): Promise<ImageDefinition> {
  // Combine JPEGTables data with the image data
  // The JPEGTables contains the JPEG encoding tables (DQT, DHT, etc.)
  // The DefineBits contains the actual image data (SOF, SOS, etc.)
  const combinedData = new Uint8Array(jpegTables.data.length + tag.imageData.length);
  combinedData.set(jpegTables.data, 0);
  combinedData.set(tag.imageData, jpegTables.data.length);

  const cleanData = fixJpegData(combinedData);
  const { width, height } = getJpegDimensions(cleanData);

  const jpegBuffer = Buffer.from(cleanData);

  // Provide RGBA data for color transforms (matching PHP's behavior)
  const sharp = (await import('sharp')).default;
  const rgba = await sharp(jpegBuffer).ensureAlpha().raw().toBuffer();

  return {
    id: tag.id,
    width,
    height,
    data: jpegBuffer,
    format: 'jpeg',
    rgba,
  };
}

/**
 * Convert DefineBitsJPEG2 to ImageDefinition.
 *
 * PHP's JpegImageDefinition can apply ColorTransform to all image data types
 * (JPEG / PNG / GIF89a) by decoding to a GD image and transforming per pixel.
 *
 * To mirror this, we always provide raw RGBA data here using sharp, while
 * keeping the original encoded data as-is where possible:
 *   - PNG / GIF89a  -> stored as PNG, rgba filled via sharp
 *   - JPEG          -> stored as cleaned JPEG, rgba filled via sharp
 */
export async function extractJpeg2(tag: DefineBitsJpeg2): Promise<ImageDefinition> {
	  const type = resolveImageDataType(tag.imageData);
	  const sharp = (await import('sharp')).default;

	  // Some SWFs embed PNG or GIF89a data in DefineBitsJPEG2 tags.
	  // PHP detects this via ImageDataType::resolve() and keeps/normalises
	  // the data as PNG while still allowing color transforms.
	  if (type === 'png' || type === 'gif89a') {
	    const inputBuffer = Buffer.from(tag.imageData);
	    const metadata = await sharp(inputBuffer).metadata();
	    const width = metadata.width ?? 0;
	    const height = metadata.height ?? 0;
	    const rgba = await sharp(inputBuffer).ensureAlpha().raw().toBuffer();

	    // For GIF89a we normalise to PNG like PHP does; for PNG we keep data.
	    const pngBuffer =
	      type === 'png'
	        ? inputBuffer
	        : await sharp(inputBuffer).png().toBuffer();

	    return {
	      id: tag.id,
	      width,
	      height,
	      data: pngBuffer,
	      format: 'png',
	      rgba,
	    };
	  }

	  // Default: treat as JPEG (matches GD::fixJpegData + JpegImageDefinition).
	  const cleanData = fixJpegData(tag.imageData);
	  const { width, height } = getJpegDimensions(cleanData);
	  const jpegBuffer = Buffer.from(cleanData);
	  const rgba = await sharp(jpegBuffer).ensureAlpha().raw().toBuffer();

	  return {
	    id: tag.id,
	    width,
	    height,
	    data: jpegBuffer,
	    format: 'jpeg',
	    rgba,
	  };
}

/**
 * Convert DefineBitsJPEG3 to ImageDefinition (with optional alpha).
 * Mirrors PHP JpegImageDefinition::toBestFormat():
 *   - JPEG without alpha  -> JPEG
 *   - JPEG with alpha     -> PNG (JPEG + alpha composed)
 *   - PNG / GIF89a        -> PNG
 */
export async function extractJpeg3(tag: DefineBitsJpeg3): Promise<ImageDefinition> {
	  const type = resolveImageDataType(tag.imageData);
	  const sharp = (await import('sharp')).default;
	  const hasAlpha = tag.alphaData.length > 0;

	  // Non-JPEG data (PNG / GIF89a) – PHP keeps or converts it to PNG but still
	  // allows color transforms by working on a GD image. We mirror this by
	  // always providing RGBA and normalising GIF89a to PNG.
	  if (type !== 'jpeg' && !hasAlpha) {
	    const inputBuffer = Buffer.from(tag.imageData);
	    const metadata = await sharp(inputBuffer).metadata();
	    const width = metadata.width ?? 0;
	    const height = metadata.height ?? 0;
	    const rgba = await sharp(inputBuffer).ensureAlpha().raw().toBuffer();

	    const pngBuffer =
	      type === 'png'
	        ? inputBuffer
	        : await sharp(inputBuffer).png().toBuffer();

	    return {
	      id: tag.id,
	      width,
	      height,
	      data: pngBuffer,
	      format: 'png',
	      rgba,
	    };
	  }

	  // JPEG data – first normalise using the same fixJpegData as PHP.
	  const cleanData = fixJpegData(tag.imageData);
	  const { width, height } = getJpegDimensions(cleanData);
	  const jpegBuffer = Buffer.from(cleanData);

	  // If no alpha data, keep as JPEG but still decode to RGBA so we can apply
	  // ColorTransform like PHP's TransformedImage::createFromJpeg.
	  if (!hasAlpha) {
	    const rgba = await sharp(jpegBuffer).ensureAlpha().raw().toBuffer();
	    return {
	      id: tag.id,
	      width,
	      height,
	      data: jpegBuffer,
	      format: 'jpeg',
	      rgba,
	      hasAlpha: false,
	    };
	  }

	  // Combine JPEG with alpha channel using sharp – result is PNG.
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

	  const pngBuffer = encodePng(width, height, rgba);

	  return {
	    id: tag.id,
	    width,
	    height,
	    data: pngBuffer,
	    format: 'png',
	    rgba,
	    hasAlpha: true,
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

