import { match } from "ts-pattern";

/** Replace all reference types in content with mapped IDs */
export function replaceReferences(
  content: string,
  mapping: Map<string, string>
): string {
  let result = content.replace(/xlink:href="#([^"]+)"/g, (original, id) => {
    const canonical = mapping.get(id);
    return canonical ? `xlink:href="#${canonical}"` : original;
  });

  result = result.replace(/href="#([^"]+)"(?!\s*xmlns)/g, (original, id) => {
    const canonical = mapping.get(id);
    return canonical ? `href="#${canonical}"` : original;
  });

  result = result.replace(/url\(#([^)]+)\)/g, (original, id) => {
    const canonical = mapping.get(id);
    return canonical ? `url(#${canonical})` : original;
  });

  return result;
}

const BASE64_PLACEHOLDER_PREFIX = "__BASE64_PLACEHOLDER_";
const DATA_IMAGE_PREFIX = "data:image/";

/**
 * Extract base64 data from content and replace with placeholders
 * Uses string operations instead of regex to handle very large base64 strings safely
 */
export function extractBase64Data(content: string): {
  content: string;
  base64Map: Map<string, string>;
} {
  const base64Map = new Map<string, string>();
  let result = content;
  let index = 0;
  let searchStart = 0;

  while (true) {
    // Find the start of a data URI
    const dataStart = result.indexOf(DATA_IMAGE_PREFIX, searchStart);
    if (dataStart === -1) break;

    // Find the ";base64," marker
    const base64Marker = result.indexOf(";base64,", dataStart);
    if (base64Marker === -1 || base64Marker > dataStart + 50) {
      // No base64 marker found nearby, skip this occurrence
      searchStart = dataStart + DATA_IMAGE_PREFIX.length;
      continue;
    }

    const dataContentStart = base64Marker + 8; // ";base64,".length

    // Find the end of base64 content (first char that's not valid base64)
    let dataEnd = dataContentStart;
    while (dataEnd < result.length) {
      const char = result[dataEnd];
      // Valid base64 chars: A-Z, a-z, 0-9, +, /, =
      if (
        (char >= "A" && char <= "Z") ||
        (char >= "a" && char <= "z") ||
        (char >= "0" && char <= "9") ||
        char === "+" ||
        char === "/" ||
        char === "="
      ) {
        dataEnd++;
      } else {
        break;
      }
    }

    // Extract the full data URI
    const dataUri = result.slice(dataStart, dataEnd);
    const placeholder = `${BASE64_PLACEHOLDER_PREFIX}${index++}__`;
    base64Map.set(placeholder, dataUri);

    // Replace in result
    result = result.slice(0, dataStart) + placeholder + result.slice(dataEnd);

    // Continue searching after the placeholder
    searchStart = dataStart + placeholder.length;
  }

  return { content: result, base64Map };
}

/** Restore base64 data from placeholders */
export function restoreBase64Data(
  content: string,
  base64Map: Map<string, string>
): string {
  let result = content;
  for (const [placeholder, original] of base64Map) {
    result = result.replace(placeholder, original);
  }
  return result;
}

/** Format bytes as human-readable string */
export function formatBytes(bytes: number): string {
  return match(bytes)
    .when(
      (b) => b < 1024,
      (b) => `${b} B`
    )
    .when(
      (b) => b < 1024 * 1024,
      (b) => `${(b / 1024).toFixed(2)} KB`
    )
    .otherwise((b) => `${(b / 1024 / 1024).toFixed(2)} MB`);
}

function roundToPrecision(value: number, precision: number): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

/** Normalize numeric values in a string (for consistent hashing) */
export function normalizeNumericValues(
  content: string,
  precision: number
): string {
  return content.replace(
    /([=":,\s(])(-?\d+\.?\d*)/g,
    (original, prefix: string, num: string) => {
      const parsed = parseFloat(num);
      if (Number.isNaN(parsed)) return original;
      return `${prefix}${roundToPrecision(parsed, precision)}`;
    }
  );
}

/** Sort attributes alphabetically within each XML tag */
export function sortTagAttributes(content: string): string {
  return content.replace(
    /<(\w+)([^>]*?)(\/?)>/g,
    (original, tag: string, attrs: string, selfClose: string) => {
      if (!attrs.trim()) return original;

      const attrPairs: Array<[string, string]> = [];
      const attrRegex = /(\S+)="([^"]*)"/g;

      for (const attrMatch of attrs.matchAll(attrRegex)) {
        attrPairs.push([attrMatch[1], attrMatch[2]]);
      }

      attrPairs.sort((a, b) => a[0].localeCompare(b[0]));

      const sortedAttrs = attrPairs.map(([k, v]) => `${k}="${v}"`).join(" ");
      const closing = selfClose ? "/>" : ">";
      return sortedAttrs ? `<${tag} ${sortedAttrs}${closing}` : `<${tag}${closing}`;
    }
  );
}

export interface UseElementAttrs {
  href: string;
  width?: number;
  height?: number;
  transform?: string;
  additionalAttrs?: Record<string, string>;
}

/** Rectangle for bin-packing */
export interface PackRect {
  id: string;
  width: number;
  height: number;
}

/** Packed rectangle with position */
export interface PackedRect extends PackRect {
  x: number;
  y: number;
}

/** Bin-packing result */
export interface PackResult {
  width: number;
  height: number;
  rects: PackedRect[];
}

/**
 * Simple shelf bin-packing algorithm
 * Packs rectangles in rows (shelves), sorted by height descending
 */
export function packRectangles(
  rects: PackRect[],
  padding: number = 1,
  maxWidth: number = 4096
): PackResult {
  if (rects.length === 0) {
    return { width: 0, height: 0, rects: [] };
  }

  // Sort by height descending for better shelf packing
  const sorted = [...rects].sort((a, b) => b.height - a.height);

  const packed: PackedRect[] = [];
  let currentX = padding;
  let currentY = padding;
  let shelfHeight = 0;
  let atlasWidth = 0;

  for (const rect of sorted) {
    const w = rect.width + padding;
    const h = rect.height + padding;

    // Check if we need to start a new shelf
    if (currentX + w > maxWidth) {
      currentX = padding;
      currentY += shelfHeight;
      shelfHeight = 0;
    }

    packed.push({
      id: rect.id,
      x: currentX,
      y: currentY,
      width: rect.width,
      height: rect.height,
    });

    currentX += w;
    shelfHeight = Math.max(shelfHeight, h);
    atlasWidth = Math.max(atlasWidth, currentX);
  }

  const atlasHeight = currentY + shelfHeight;

  return {
    width: atlasWidth,
    height: atlasHeight,
    rects: packed,
  };
}

/** Build use element attribute string */
export function buildUseElementAttrs(attrs: UseElementAttrs): string {
  const parts: string[] = [`xlink:href="${attrs.href}"`];

  if (attrs.width !== undefined) {
    parts.push(`width="${attrs.width}"`);
  }
  if (attrs.height !== undefined) {
    parts.push(`height="${attrs.height}"`);
  }
  if (attrs.transform) {
    parts.push(`transform="${attrs.transform}"`);
  }

  if (attrs.additionalAttrs) {
    for (const [key, value] of Object.entries(attrs.additionalAttrs)) {
      parts.push(`${key}="${value}"`);
    }
  }

  return parts.join(" ");
}
