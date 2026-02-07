import * as fs from "node:fs";
import * as path from "node:path";

import type {
  AtlasFrame,
  AtlasManifest,
  DeduplicationResult,
  OptimizationOptions,
  ParsedFrame,
  ProcessedSprite,
  UseElement,
} from "../types.ts";
import type { ImageRegistry } from "./image-exporter.ts";
import {
  buildCanonicalDefinitions,
  sortDefinitionsTopologically,
} from "./deduplicator.ts";
import {
  buildUseElementAttrs,
  formatBytes as formatBytesUtil,
  type PackedRect,
  type PackRect,
  packRectangles,
} from "./utils.ts";

const SVG_HEADER = `<?xml version="1.0" encoding="UTF-8"?>`;
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const DEFAULT_OPTIMIZATION: OptimizationOptions = {
  shortIds: false,
  minify: false,
  precision: 2,
  stripDefaults: false,
};

const STRIP_DEFAULTS: Record<string, string> = {
  "fill-rule": "evenodd",
  stroke: "none",
  "fill-opacity": "1",
  "stroke-opacity": "1",
  opacity: "1",
};

function stripDefaultAttributes(content: string): string {
  let result = content;

  for (const [attr, defaultVal] of Object.entries(STRIP_DEFAULTS)) {
    const regex = new RegExp(`\\s+${attr}="${defaultVal}"`, "g");
    result = result.replace(regex, "");
  }

  return result;
}

/**
 * Replace stroke-width with __RESOLUTION__ placeholder for non-scaling-stroke elements
 */
function processNonScalingStroke(content: string): string {
  // Match elements with vector-effect="non-scaling-stroke" and replace their stroke-width
  return content
    .replace(
      /(<[^>]*vector-effect="non-scaling-stroke"[^>]*stroke-width=")([^"]+)("[^>]*>)/g,
      "$1__RESOLUTION__$3"
    )
    .replace(
      // Also handle case where stroke-width comes before vector-effect
      /(<[^>]*stroke-width=")([^"]+)("[^>]*vector-effect="non-scaling-stroke"[^>]*>)/g,
      "$1__RESOLUTION__$3"
    );
}

function minifySvg(content: string): string {
  return content
    .replace(/\n/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
}

function indent(
  content: string,
  spaces: number,
  minify: boolean = false
): string {
  if (minify) return content;
  const prefix = " ".repeat(spaces);
  return content
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

function toInternalRef(href: string): string {
  if (href.startsWith("#")) {
    return href;
  }
  const hashIndex = href.indexOf("#");
  return hashIndex >= 0 ? href.slice(hashIndex) : href;
}

function renderUseElement(use: UseElement, useInternalRefs: boolean): string {
  const href = useInternalRefs
    ? toInternalRef(use.canonicalHref ?? use.originalHref)
    : (use.canonicalHref ?? use.originalHref);

  return `<use ${buildUseElementAttrs({
    href,
    width: use.width,
    height: use.height,
    transform: use.transform,
    additionalAttrs: use.attributes,
  })}/>`;
}

function hasValidReference(use: UseElement): boolean {
  const href = use.canonicalHref ?? use.originalHref;
  return (
    href.startsWith("#def_") ||
    href.match(/^#d\d/) !== null ||
    !href.startsWith("#")
  );
}

/** Frame dimension data for packing */
interface FrameDimension {
  id: string;
  index: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Lookup map from frame id to packed position */
type PackedPositionMap = Map<string, PackedRect>;

/** Parse transform to extract translation offset */
function extractTranslation(transform: string | undefined): { x: number; y: number } {
  if (!transform) return { x: 0, y: 0 };

  const matrixMatch = transform.match(
    /matrix\s*\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/
  );
  if (matrixMatch) {
    return { x: parseFloat(matrixMatch[5]), y: parseFloat(matrixMatch[6]) };
  }

  const translateMatch = transform.match(
    /translate\s*\(\s*([^,)]+)(?:,\s*([^)]+))?\)/
  );
  if (translateMatch) {
    return {
      x: parseFloat(translateMatch[1]),
      y: translateMatch[2] ? parseFloat(translateMatch[2]) : 0,
    };
  }

  return { x: 0, y: 0 };
}

/** Compute tight content bounds from use elements + transforms */
function computeContentBounds(
  sprite: ProcessedSprite,
  vbMinX: number,
  vbMinY: number,
  vbWidth: number,
  vbHeight: number
): { minX: number; minY: number; width: number; height: number } {
  const mainOff = extractTranslation(sprite.mainTransform);
  const validUses = sprite.useElements.filter(hasValidReference);

  // Fall back to full viewBox if any use element lacks dimensions
  if (validUses.length === 0 || validUses.some((u) => u.width == null || u.height == null)) {
    return { minX: vbMinX, minY: vbMinY, width: vbWidth, height: vbHeight };
  }

  let bMinX = Infinity;
  let bMinY = Infinity;
  let bMaxX = -Infinity;
  let bMaxY = -Infinity;

  for (const use of validUses) {
    const useOff = extractTranslation(use.transform);
    const x = mainOff.x + useOff.x;
    const y = mainOff.y + useOff.y;
    bMinX = Math.min(bMinX, x);
    bMinY = Math.min(bMinY, y);
    bMaxX = Math.max(bMaxX, x + use.width!);
    bMaxY = Math.max(bMaxY, y + use.height!);
  }

  // Clamp to viewBox and add 1px margin
  const margin = 1;
  bMinX = Math.max(Math.floor(bMinX) - margin, vbMinX);
  bMinY = Math.max(Math.floor(bMinY) - margin, vbMinY);
  bMaxX = Math.min(Math.ceil(bMaxX) + margin, vbMinX + vbWidth);
  bMaxY = Math.min(Math.ceil(bMaxY) + margin, vbMinY + vbHeight);

  return {
    minX: bMinX,
    minY: bMinY,
    width: bMaxX - bMinX,
    height: bMaxY - bMinY,
  };
}

function generateAtlasSvg(
  frames: ParsedFrame[],
  dedup: DeduplicationResult,
  sprites: ProcessedSprite[],
  options: Partial<OptimizationOptions> = {},
  svgOutputDir?: string,
  imageRegistry?: ImageRegistry
): { svg: string; manifest: AtlasManifest } {
  const opts = { ...DEFAULT_OPTIMIZATION, ...options };
  const uniqueSprites = sprites.filter((s) => !s.duplicateOf);

  // Build frame dimensions cropped to content bounds
  const frameDimensions: FrameDimension[] = uniqueSprites.map(
    (sprite, index) => {
      const parts = sprite.viewBox.split(/\s+/).map(Number);
      const vbMinX = parts[0] || 0;
      const vbMinY = parts[1] || 0;
      const vbWidth = parts[2] || 100;
      const vbHeight = parts[3] || 100;

      const bounds = computeContentBounds(sprite, vbMinX, vbMinY, vbWidth, vbHeight);
      return {
        id: sprite.id,
        index,
        minX: bounds.minX,
        minY: bounds.minY,
        width: bounds.width,
        height: bounds.height,
      };
    }
  );

  // Create pack rectangles for bin-packing
  const packRects: PackRect[] = frameDimensions.map((dim) => ({
    id: dim.id,
    width: Math.ceil(dim.width),
    height: Math.ceil(dim.height),
  }));

  // Pack rectangles using bin-packing algorithm
  const packResult = packRectangles(packRects, 1, 4096);
  const atlasWidth = packResult.width;
  const atlasHeight = packResult.height;

  // Create lookup map from frame id to packed position
  const packedPositions: PackedPositionMap = new Map();
  for (const packed of packResult.rects) {
    packedPositions.set(packed.id, packed);
  }

  // Get positioning offset from first frame (all frames in an animation share the same offset)
  const firstFrame = frames[0];
  const positioningOffsetX = firstFrame ? -firstFrame.positioningOffset.x : 0;
  const positioningOffsetY = firstFrame ? -firstFrame.positioningOffset.y : 0;

  const rebuiltDefs = buildCanonicalDefinitions(
    frames,
    dedup,
    svgOutputDir,
    imageRegistry
  );
  const sortedHashes = sortDefinitionsTopologically(
    dedup.canonicalDefs,
    rebuiltDefs
  );

  const lines: string[] = [];
  lines.push(SVG_HEADER);
  lines.push(
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${atlasWidth}" height="${atlasHeight}" viewBox="0 0 ${atlasWidth} ${atlasHeight}">`
  );
  lines.push("  <defs>");

  for (const hash of sortedHashes) {
    const canonicalDef = dedup.canonicalDefs.get(hash);
    if (!canonicalDef) {
      continue;
    }

    let content = rebuiltDefs.get(canonicalDef.id);
    if (!content) {
      continue;
    }

    content = processNonScalingStroke(content);
    if (opts.stripDefaults) {
      content = stripDefaultAttributes(content);
    }
    lines.push(indent(content, 4, opts.minify));
  }

  // Generate clip paths for each packed frame
  for (let i = 0; i < uniqueSprites.length; i++) {
    const sprite = uniqueSprites[i];
    const packed = packedPositions.get(sprite.id);
    if (!packed) {
      continue;
    }
    lines.push(
      `    <clipPath id="clip_${i}"><rect x="${packed.x}" y="${packed.y}" width="${packed.width}" height="${packed.height}"/></clipPath>`
    );
  }

  lines.push("  </defs>");
  lines.push("");

  const atlasFrames: AtlasFrame[] = [];
  const duplicates: Record<string, string> = {};

  for (let i = 0; i < uniqueSprites.length; i++) {
    const sprite = uniqueSprites[i];
    const dim = frameDimensions[i];
    const packed = packedPositions.get(sprite.id);

    if (!packed) {
      continue;
    }

    // Store frame position and dimensions in atlas
    // offsetX/offsetY are the viewBox origin (trim offset within the frame)
    atlasFrames.push({
      id: sprite.id,
      x: packed.x,
      y: packed.y,
      width: packed.width,
      height: packed.height,
      offsetX: dim.minX,
      offsetY: dim.minY,
    });

    // Calculate translation to place content at packed position
    const translateX = packed.x - dim.minX;
    const translateY = packed.y - dim.minY;

    lines.push(`  <!-- Frame: ${sprite.id} -->`);
    lines.push(`  <g clip-path="url(#clip_${i})">`);
    lines.push(`    <g transform="translate(${translateX}, ${translateY})">`);

    if (sprite.mainTransform) {
      lines.push(`      <g transform="${sprite.mainTransform}">`);
    }

    const validUseElements = sprite.useElements.filter(hasValidReference);
    for (const use of validUseElements) {
      lines.push("        " + renderUseElement(use, true));
    }

    if (sprite.mainTransform) {
      lines.push("      </g>");
    }
    lines.push("    </g>");
    lines.push("  </g>");
  }

  for (const sprite of sprites) {
    if (sprite.duplicateOf) {
      duplicates[sprite.id] = sprite.duplicateOf;
    }
  }

  lines.push("</svg>");

  const animationName = uniqueSprites[0]?.animationName || "unknown";
  const manifest: AtlasManifest = {
    version: 1,
    animation: animationName,
    width: atlasWidth,
    height: atlasHeight,
    offsetX: positioningOffsetX,
    offsetY: positioningOffsetY,
    frames: atlasFrames,
    frameOrder: sprites.map((s) => s.id),
    duplicates,
    fps: 60,
  };

  const svg = opts.minify ? minifySvg(lines.join("\n")) : lines.join("\n");

  return { svg, manifest };
}

/**
 * Write atlas output files
 */
export async function writeAtlasOutput(
  outputDir: string,
  frames: ParsedFrame[],
  dedup: DeduplicationResult,
  sprites: ProcessedSprite[],
  options: Partial<OptimizationOptions> = {},
  imageRegistry?: ImageRegistry
): Promise<{ atlasSize: number; manifest: AtlasManifest }> {
  fs.mkdirSync(outputDir, { recursive: true });

  const { svg, manifest } = generateAtlasSvg(
    frames,
    dedup,
    sprites,
    options,
    outputDir,
    imageRegistry
  );

  const atlasPath = path.join(outputDir, "atlas.svg");
  await Bun.write(atlasPath, svg);

  return {
    atlasSize: svg.length,
    manifest,
  };
}

/**
 * Calculate input size from file paths
 */
export async function calculateInputSize(filePaths: string[]): Promise<number> {
  let total = 0;

  for (const filePath of filePaths) {
    try {
      const stat = fs.statSync(filePath);
      total += stat.size;
    } catch {
      // Ignore errors
    }
  }

  return total;
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  return formatBytesUtil(bytes);
}
