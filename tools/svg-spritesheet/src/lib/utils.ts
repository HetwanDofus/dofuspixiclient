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

/** Free rectangle in the MaxRects algorithm */
interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsIntersect(a: FreeRect, b: FreeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function isContainedIn(inner: FreeRect, outer: FreeRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Split a free rect around a placed rect, returning remaining pieces */
function splitFreeRect(free: FreeRect, placed: FreeRect): FreeRect[] {
  if (!rectsIntersect(free, placed)) return [free];

  const result: FreeRect[] = [];

  // Left piece
  if (placed.x > free.x) {
    result.push({
      x: free.x,
      y: free.y,
      width: placed.x - free.x,
      height: free.height,
    });
  }
  // Right piece
  const placedRight = placed.x + placed.width;
  const freeRight = free.x + free.width;
  if (placedRight < freeRight) {
    result.push({
      x: placedRight,
      y: free.y,
      width: freeRight - placedRight,
      height: free.height,
    });
  }
  // Top piece
  if (placed.y > free.y) {
    result.push({
      x: free.x,
      y: free.y,
      width: free.width,
      height: placed.y - free.y,
    });
  }
  // Bottom piece
  const placedBottom = placed.y + placed.height;
  const freeBottom = free.y + free.height;
  if (placedBottom < freeBottom) {
    result.push({
      x: free.x,
      y: placedBottom,
      width: free.width,
      height: freeBottom - placedBottom,
    });
  }

  return result;
}

/** Remove free rects fully contained within another */
function pruneFreeRects(freeRects: FreeRect[]): void {
  for (let i = freeRects.length - 1; i >= 0; i--) {
    for (let j = 0; j < freeRects.length; j++) {
      if (i !== j && isContainedIn(freeRects[i], freeRects[j])) {
        freeRects.splice(i, 1);
        break;
      }
    }
  }
}

/** MaxRects bin-packing with Best Short Side Fit heuristic */
function maxRectsPack(
  sorted: PackRect[],
  padding: number,
  stripWidth: number
): PackResult {
  if (sorted.length === 0) return { width: 0, height: 0, rects: [] };

  const packed: PackedRect[] = [];
  const maxH = sorted.reduce((sum, r) => sum + r.height + padding, padding);
  const freeRects: FreeRect[] = [
    { x: padding, y: padding, width: stripWidth - padding, height: maxH },
  ];

  for (const rect of sorted) {
    const w = rect.width + padding;
    const h = rect.height + padding;

    // Best Short Side Fit
    let bestIdx = -1;
    let bestSSF = Infinity;
    let bestLSF = Infinity;

    for (let i = 0; i < freeRects.length; i++) {
      const fr = freeRects[i];
      if (w <= fr.width && h <= fr.height) {
        const ssf = Math.min(fr.width - w, fr.height - h);
        const lsf = Math.max(fr.width - w, fr.height - h);
        if (ssf < bestSSF || (ssf === bestSSF && lsf < bestLSF)) {
          bestSSF = ssf;
          bestLSF = lsf;
          bestIdx = i;
        }
      }
    }

    if (bestIdx === -1) continue;

    const fr = freeRects[bestIdx];
    packed.push({
      id: rect.id,
      x: fr.x,
      y: fr.y,
      width: rect.width,
      height: rect.height,
    });

    const placedRect: FreeRect = { x: fr.x, y: fr.y, width: w, height: h };

    // Split all free rects that intersect with the placed rect
    const newFree: FreeRect[] = [];
    for (const free of freeRects) {
      newFree.push(...splitFreeRect(free, placedRect));
    }

    freeRects.length = 0;
    freeRects.push(...newFree);
    pruneFreeRects(freeRects);
  }

  let atlasWidth = 0;
  let atlasHeight = 0;
  for (const p of packed) {
    atlasWidth = Math.max(atlasWidth, p.x + p.width + padding);
    atlasHeight = Math.max(atlasHeight, p.y + p.height + padding);
  }

  return { width: atlasWidth, height: atlasHeight, rects: packed };
}

/** Sort comparators for trying different placement orders */
const SORT_STRATEGIES: Array<(a: PackRect, b: PackRect) => number> = [
  (a, b) => b.height - a.height || b.width - a.width,
  (a, b) => b.width * b.height - a.width * a.height || b.height - a.height,
  (a, b) => b.width - a.width || b.height - a.height,
  (a, b) =>
    Math.max(b.width, b.height) - Math.max(a.width, a.height) ||
    b.width * b.height - a.width * a.height,
];

/**
 * Generate candidate widths to search.
 * For small ranges, tries every integer; for large ranges, uses smart sampling.
 */
function generateSearchWidths(
  rects: PackRect[],
  padding: number,
  minWidth: number,
  maxWidth: number
): number[] {
  const totalWidth = rects.reduce((s, r) => s + r.width + padding, padding);
  const upperWidth = Math.min(totalWidth, maxWidth);
  const range = upperWidth - minWidth;

  // Small range: brute-force every integer
  if (range <= 1000) {
    const widths: number[] = [];
    for (let w = minWidth; w <= upperWidth; w++) widths.push(w);
    return widths;
  }

  // Large range: sample key widths + evenly spaced grid
  const candidates = new Set<number>();
  const step = Math.max(1, Math.floor(range / 500));

  for (let w = minWidth; w <= upperWidth; w += step) candidates.add(w);
  candidates.add(minWidth);
  candidates.add(upperWidth);

  // Add pairwise sums of unique widths (important breakpoints)
  const uniqueW = [...new Set(rects.map((r) => r.width))];
  for (let i = 0; i < uniqueW.length; i++) {
    for (let j = i; j < uniqueW.length; j++) {
      const w = uniqueW[i] + uniqueW[j] + padding * 3;
      if (w >= minWidth && w <= upperWidth) candidates.add(w);
    }
  }

  // Add sqrt-area heuristic
  const totalArea = rects.reduce(
    (sum, r) => sum + (r.width + padding) * (r.height + padding),
    0
  );
  const sqrtW = Math.ceil(Math.sqrt(totalArea));
  if (sqrtW >= minWidth && sqrtW <= upperWidth) candidates.add(sqrtW);

  return Array.from(candidates).sort((a, b) => a - b);
}

/**
 * MaxRects bin-packing with optimal width search.
 * Tries multiple strip widths and sort strategies, picking the minimum-area result.
 */
export function packRectangles(
  rects: PackRect[],
  padding: number = 1,
  maxWidth: number = 4096
): PackResult {
  if (rects.length === 0) {
    return { width: 0, height: 0, rects: [] };
  }

  const minWidth =
    rects.reduce((m, r) => Math.max(m, r.width), 0) + padding * 2;
  const widths = generateSearchWidths(rects, padding, minWidth, maxWidth);

  let bestResult: PackResult | null = null;
  let bestArea = Infinity;

  for (const sortFn of SORT_STRATEGIES) {
    const sorted = [...rects].sort(sortFn);

    for (const w of widths) {
      const result = maxRectsPack(sorted, padding, w);
      if (result.rects.length < rects.length) continue;
      const area = result.width * result.height;
      if (area < bestArea) {
        bestArea = area;
        bestResult = result;
      }
    }
  }

  return bestResult!;
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
