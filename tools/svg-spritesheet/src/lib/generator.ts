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
import {
  buildCanonicalDefinitions,
  sortDefinitionsTopologically,
} from "./deduplicator.ts";
import {
  buildUseElementAttrs,
  formatBytes as formatBytesUtil,
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

function calculateAtlasLayout(
  frames: Array<{ width: number; height: number }>,
  maxTextureSize: number = 2048
): { columns: number; rows: number; cellWidth: number; cellHeight: number } {
  if (frames.length === 0) {
    return { columns: 1, rows: 1, cellWidth: 100, cellHeight: 100 };
  }

  let cellWidth = 0;
  let cellHeight = 0;
  for (const frame of frames) {
    cellWidth = Math.max(cellWidth, Math.ceil(frame.width));
    cellHeight = Math.max(cellHeight, Math.ceil(frame.height));
  }

  const columns = Math.max(
    1,
    Math.min(frames.length, Math.floor(maxTextureSize / cellWidth))
  );
  const rows = Math.ceil(frames.length / columns);

  return { columns, rows, cellWidth, cellHeight };
}

function generateAtlasSvg(
  frames: ParsedFrame[],
  dedup: DeduplicationResult,
  sprites: ProcessedSprite[],
  options: Partial<OptimizationOptions> = {}
): { svg: string; manifest: AtlasManifest } {
  const opts = { ...DEFAULT_OPTIMIZATION, ...options };
  const uniqueSprites = sprites.filter((s) => !s.duplicateOf);

  const frameDimensions = uniqueSprites.map((sprite) => {
    const parts = sprite.viewBox.split(/\s+/).map(Number);
    return {
      id: sprite.id,
      minX: parts[0] || 0,
      minY: parts[1] || 0,
      width: parts[2] || 100,
      height: parts[3] || 100,
    };
  });

  const layout = calculateAtlasLayout(frameDimensions);
  const atlasWidth = layout.columns * layout.cellWidth;
  const atlasHeight = layout.rows * layout.cellHeight;

  const rebuiltDefs = buildCanonicalDefinitions(frames, dedup);
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
    if (!canonicalDef) continue;

    let content = rebuiltDefs.get(canonicalDef.id);
    if (!content) continue;

    content = processNonScalingStroke(content);
    if (opts.stripDefaults) {
      content = stripDefaultAttributes(content);
    }
    lines.push(indent(content, 4, opts.minify));
  }

  for (let i = 0; i < uniqueSprites.length; i++) {
    const col = i % layout.columns;
    const row = Math.floor(i / layout.columns);
    const x = col * layout.cellWidth;
    const y = row * layout.cellHeight;
    lines.push(
      `    <clipPath id="clip_${i}"><rect x="${x}" y="${y}" width="${layout.cellWidth}" height="${layout.cellHeight}"/></clipPath>`
    );
  }

  lines.push("  </defs>");
  lines.push("");

  const atlasFrames: AtlasFrame[] = [];
  const duplicates: Record<string, string> = {};

  for (let i = 0; i < uniqueSprites.length; i++) {
    const sprite = uniqueSprites[i];
    const dim = frameDimensions[i];

    const col = i % layout.columns;
    const row = Math.floor(i / layout.columns);
    const x = col * layout.cellWidth;
    const y = row * layout.cellHeight;

    const frameWidth = layout.cellWidth;
    const frameHeight = layout.cellHeight;

    atlasFrames.push({
      id: sprite.id,
      x,
      y,
      width: frameWidth,
      height: frameHeight,
      offsetX: dim.minX,
      offsetY: dim.minY,
    });

    const translateX = x - dim.minX;
    const translateY = y - dim.minY;

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
  options: Partial<OptimizationOptions> = {}
): Promise<{ atlasSize: number; manifestSize: number }> {
  fs.mkdirSync(outputDir, { recursive: true });

  const { svg, manifest } = generateAtlasSvg(frames, dedup, sprites, options);

  const atlasPath = path.join(outputDir, "atlas.svg");
  await Bun.write(atlasPath, svg);

  const manifestPath = path.join(outputDir, "atlas.json");
  const manifestJson = JSON.stringify(manifest, null, 2);
  await Bun.write(manifestPath, manifestJson);

  return {
    atlasSize: svg.length,
    manifestSize: manifestJson.length,
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
