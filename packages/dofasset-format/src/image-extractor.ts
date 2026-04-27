import { createHash } from "node:crypto";

import type { ExtractedImage, ParsedPattern } from "./types.js";

/**
 * Extract and deduplicate images from pattern definitions across all animations.
 */
export function extractImages(allPatterns: ParsedPattern[]): ExtractedImage[] {
  const seen = new Map<string, number>(); // content hash → image id
  const images: ExtractedImage[] = [];

  for (const pattern of allPatterns) {
    const b64 = pattern.imageDataUri.replace(/^data:image\/\w+;base64,/, "");
    if (!b64) continue; // pattern with no resolvable image data — skip
    const pngBytes = new Uint8Array(Buffer.from(b64, "base64"));
    if (pngBytes.byteLength < 24) continue; // truncated/corrupt blob — skip
    const contentHash = createHash("sha256")
      .update(pngBytes)
      .digest("hex")
      .slice(0, 16);

    if (seen.has(contentHash)) {
      continue;
    }

    // Decode PNG header to get dimensions. Fall back to pattern.width/height
    // (the SVG <pattern> tile size, which matches the image's pixel size for
    // Flash-exported assets) when the blob isn't a readable PNG.
    const parsed = parsePngDimensions(pngBytes);
    const width = parsed.width > 0 ? parsed.width : Math.max(0, pattern.width);
    const height = parsed.height > 0 ? parsed.height : Math.max(0, pattern.height);

    const id = images.length;
    images.push({ id, width, height, pngBytes, contentHash });
    seen.set(contentHash, id);
  }

  return images;
}

/**
 * Read width/height from PNG IHDR chunk.
 * PNG format: 8-byte signature, then IHDR chunk with width (4 bytes BE) and height (4 bytes BE).
 * Returns (0, 0) when the blob is too short or not a PNG — caller must
 * fall back to an alternative source (SVG pattern dims).
 */
function parsePngDimensions(data: Uint8Array): {
  width: number;
  height: number;
} {
  if (data.byteLength < 24) return { width: 0, height: 0 };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A. Bail on non-PNG blobs instead
  // of returning garbage width/height that downstream rendering would trust.
  if (
    view.getUint32(0, false) !== 0x89504e47 ||
    view.getUint32(4, false) !== 0x0d0a1a0a
  ) {
    return { width: 0, height: 0 };
  }
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}
