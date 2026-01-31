/**
 * Generator - Output generation for defs.svg and sprites.svg
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  DeduplicationResult,
  ProcessedSprite,
  UseElement,
  OptimizationOptions,
  AtlasFrame,
  AtlasManifest,
} from '../types.ts';
import {
  buildCanonicalDefinitions,
  sortDefinitionsTopologically,
  type ProcessedSprite as DeduplicatorProcessedSprite,
} from './deduplicator.ts';
import type { ParsedFrame } from '../types.ts';
import {
  escapeXml,
  fixSvgXml,
  formatBytes as formatBytesUtil,
  buildUseElementAttrs,
} from './utils.ts';

const SVG_HEADER = `<?xml version="1.0" encoding="UTF-8"?>`;
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Default optimization options */
const DEFAULT_OPTIMIZATION: OptimizationOptions = {
  shortIds: false,
  minify: false,
  precision: 2,
  stripDefaults: false,
};

/** Redundant attributes that can be stripped */
const STRIP_DEFAULTS: Record<string, string> = {
  'fill-rule': 'evenodd',
  'stroke': 'none',
  'fill-opacity': '1',
  'stroke-opacity': '1',
  'opacity': '1',
};

/**
 * Strip redundant/default attributes from SVG content
 */
function stripDefaultAttributes(content: string): string {
  let result = content;
  for (const [attr, defaultVal] of Object.entries(STRIP_DEFAULTS)) {
    // Match attribute with default value and remove it
    const regex = new RegExp(`\\s+${attr}="${defaultVal}"`, 'g');
    result = result.replace(regex, '');
  }
  return result;
}

/**
 * Minify SVG content by removing unnecessary whitespace
 */
function minifySvg(content: string): string {
  return content
    // Remove newlines and multiple spaces
    .replace(/\n/g, '')
    .replace(/\s{2,}/g, ' ')
    // Remove spaces around tags
    .replace(/>\s+</g, '><')
    // Remove leading/trailing whitespace
    .trim();
}

/**
 * Indentation helper
 */
function indent(content: string, spaces: number, minify: boolean = false): string {
  if (minify) return content;
  const prefix = ' '.repeat(spaces);
  return content
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

/**
 * Generate defs section content
 */
function generateDefsContent(
  frames: ParsedFrame[],
  dedup: DeduplicationResult,
  opts: OptimizationOptions = DEFAULT_OPTIMIZATION
): string[] {
  const rebuiltDefs = buildCanonicalDefinitions(frames, dedup);
  const sortedHashes = sortDefinitionsTopologically(dedup.canonicalDefs, rebuiltDefs);
  const lines: string[] = [];

  for (const hash of sortedHashes) {
    const canonicalDef = dedup.canonicalDefs.get(hash);
    if (!canonicalDef) continue;

    let content = rebuiltDefs.get(canonicalDef.id);
    if (!content) continue;

    content = fixSvgXml(content);

    // Strip default attributes if enabled
    if (opts.stripDefaults) {
      content = stripDefaultAttributes(content);
    }

    lines.push(indent(content, opts.minify ? 0 : 4, opts.minify));
  }

  return lines;
}

/**
 * Convert href to internal reference format
 */
function toInternalRef(href: string): string {
  // If it's already a local reference, keep it
  if (href.startsWith('#')) {
    return href;
  }
  // Convert "defs.svg#id" or similar to "#id"
  const hashIndex = href.indexOf('#');
  return hashIndex >= 0 ? href.slice(hashIndex) : href;
}

/**
 * Render a single use element
 */
function renderUseElement(use: UseElement, useInternalRefs: boolean): string {
  const href = useInternalRefs ? toInternalRef(use.canonicalHref ?? use.originalHref) : (use.canonicalHref ?? use.originalHref);

  return `<use ${buildUseElementAttrs({
    href,
    width: use.width,
    height: use.height,
    transform: use.transform,
    additionalAttrs: use.attributes,
  })}/>`;
}

/**
 * Check if a use element has a valid canonical reference
 * Orphan references (those that don't map to any definition) should be filtered out
 */
function hasValidReference(use: UseElement): boolean {
  const href = use.canonicalHref ?? use.originalHref;
  // If canonicalHref starts with #def_ or #d (short ID), it was properly mapped
  // If it still has the original short ID (like #n, #p, #t), it's orphan
  return href.startsWith('#def_') || href.match(/^#d\d/) !== null || !href.startsWith('#');
}

/**
 * Render a sprite symbol
 */
function renderSymbol(
  sprite: ProcessedSprite,
  useInternalRefs: boolean,
  opts: OptimizationOptions = DEFAULT_OPTIMIZATION
): string[] {
  const lines: string[] = [];
  const minify = opts.minify;

  // Filter out use elements with orphan references (those that don't exist in defs)
  const validUseElements = sprite.useElements.filter(hasValidReference);

  if (minify) {
    // Minified: single line
    let symbolContent = `<symbol id="${escapeXml(sprite.id)}" viewBox="${sprite.viewBox}">`;

    if (sprite.mainTransform) {
      symbolContent += `<g transform="${escapeXml(sprite.mainTransform)}">`;
    }

    for (const use of validUseElements) {
      symbolContent += renderUseElement(use, useInternalRefs);
    }

    if (sprite.mainTransform) {
      symbolContent += '</g>';
    }

    symbolContent += '</symbol>';
    lines.push(symbolContent);
  } else {
    // Pretty printed
    lines.push(`  <symbol id="${escapeXml(sprite.id)}" viewBox="${sprite.viewBox}">`);

    const hasMainGroup = Boolean(sprite.mainTransform);
    const useIndent = hasMainGroup ? '      ' : '    ';

    if (hasMainGroup) {
      lines.push(`    <g transform="${escapeXml(sprite.mainTransform)}">`);
    }

    for (const use of validUseElements) {
      lines.push(useIndent + renderUseElement(use, useInternalRefs));
    }

    if (hasMainGroup) {
      lines.push('    </g>');
    }

    lines.push('  </symbol>');
  }

  return lines;
}

/**
 * Generate defs.svg with all deduplicated definitions
 */
export function generateDefsSvg(
  frames: ParsedFrame[],
  dedup: DeduplicationResult
): string {
  const lines: string[] = [
    SVG_HEADER,
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">`,
    '  <defs>',
  ];

  lines.push(...generateDefsContent(frames, dedup));

  lines.push('  </defs>');
  lines.push('</svg>');

  return lines.join('\n');
}

/**
 * Generate sprites.svg with all frame symbols
 */
export function generateSpritesSvg(
  sprites: ProcessedSprite[],
  useInternalRefs: boolean = true
): string {
  const lines: string[] = [
    SVG_HEADER,
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">`,
  ];

  for (const sprite of sprites) {
    // Skip duplicates - they'll reference the original
    if (sprite.duplicateOf) continue;

    lines.push(...renderSymbol(sprite, useInternalRefs));
  }

  lines.push('</svg>');

  return lines.join('\n');
}

/**
 * Generate a combined spritesheet.svg with both defs and symbols
 * This is the main output file that can be used directly
 */
export function generateCombinedSvg(
  frames: ParsedFrame[],
  dedup: DeduplicationResult,
  sprites: ProcessedSprite[],
  options: Partial<OptimizationOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIMIZATION, ...options };
  const minify = opts.minify;

  const lines: string[] = [];

  if (minify) {
    // Minified output
    lines.push(`${SVG_HEADER}<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"><defs>`);

    // Add definitions (already minified from generateDefsContent)
    const defContent = generateDefsContent(frames, dedup, opts);
    lines.push(defContent.join(''));

    lines.push('</defs>');

    // Add symbols for each frame
    for (const sprite of sprites) {
      if (sprite.duplicateOf) continue;
      lines.push(...renderSymbol(sprite, true, opts));
    }

    lines.push('</svg>');

    return lines.join('');
  } else {
    // Pretty printed output
    lines.push(SVG_HEADER);
    lines.push(`<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">`);
    lines.push('  <defs>');

    // Add definitions
    lines.push(...generateDefsContent(frames, dedup, opts));

    lines.push('  </defs>');
    lines.push('');

    // Add symbols for each frame
    for (const sprite of sprites) {
      if (sprite.duplicateOf) continue;
      lines.push(...renderSymbol(sprite, true, opts));
    }

    lines.push('</svg>');

    return lines.join('\n');
  }
}

/**
 * Write output files to directory
 */
export async function writeOutput(
  outputDir: string,
  frames: ParsedFrame[],
  dedup: DeduplicationResult,
  sprites: ProcessedSprite[],
  options: Partial<OptimizationOptions> = {}
): Promise<{ defsSize: number; spritesSize: number; combinedSize: number }> {
  const opts = { ...DEFAULT_OPTIMIZATION, ...options };

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate and write defs.svg (for reference/debugging - not minified)
  const defsSvg = generateDefsSvg(frames, dedup);
  const defsPath = path.join(outputDir, 'defs.svg');
  await Bun.write(defsPath, defsSvg);

  // Generate and write sprites.svg (standalone symbols, for reference - not minified)
  const spritesSvg = generateSpritesSvg(sprites, true);
  const spritesPath = path.join(outputDir, 'sprites.svg');
  await Bun.write(spritesPath, spritesSvg);

  // Generate and write combined spritesheet.svg (main output file - optimized)
  const combinedSvg = generateCombinedSvg(frames, dedup, sprites, opts);
  const combinedPath = path.join(outputDir, 'spritesheet.svg');
  await Bun.write(combinedPath, combinedSvg);

  return {
    defsSize: defsSvg.length,
    spritesSize: spritesSvg.length,
    combinedSize: combinedSvg.length,
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

/**
 * Calculate optimal grid layout for atlas with max texture size constraint
 * WebGPU default max texture size is 8192, but we use 2048 for safety across devices
 */
function calculateAtlasLayout(
  frames: Array<{ width: number; height: number }>,
  maxTextureSize: number = 2048
): { columns: number; rows: number; cellWidth: number; cellHeight: number } {
  if (frames.length === 0) {
    return { columns: 1, rows: 1, cellWidth: 100, cellHeight: 100 };
  }

  // Find max frame dimensions (round up for safety)
  let cellWidth = 0;
  let cellHeight = 0;
  for (const frame of frames) {
    cellWidth = Math.max(cellWidth, Math.ceil(frame.width));
    cellHeight = Math.max(cellHeight, Math.ceil(frame.height));
  }

  // Calculate optimal columns to fit within maxTextureSize
  // Ensure at least 1 column even if a single frame exceeds maxTextureSize
  const columns = Math.max(1, Math.min(frames.length, Math.floor(maxTextureSize / cellWidth)));
  const rows = Math.ceil(frames.length / columns);

  return { columns, rows, cellWidth, cellHeight };
}

/**
 * Generate a pre-rendered atlas SVG where frames are laid out in a grid
 * This can be loaded directly as a texture without any runtime manipulation
 */
export function generateAtlasSvg(
  frames: ParsedFrame[],
  dedup: DeduplicationResult,
  sprites: ProcessedSprite[],
  options: Partial<OptimizationOptions> = {}
): { svg: string; manifest: AtlasManifest } {
  const opts = { ...DEFAULT_OPTIMIZATION, ...options };

  // Filter out duplicate sprites - only render unique ones
  const uniqueSprites = sprites.filter((s) => !s.duplicateOf);

  // Get frame dimensions from viewBox (keep exact values for proper rendering)
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

  // Calculate layout (all integer dimensions)
  const layout = calculateAtlasLayout(frameDimensions);
  const atlasWidth = layout.columns * layout.cellWidth;
  const atlasHeight = layout.rows * layout.cellHeight;

  // Build defs content (shared definitions)
  const rebuiltDefs = buildCanonicalDefinitions(frames, dedup);
  const sortedHashes = sortDefinitionsTopologically(dedup.canonicalDefs, rebuiltDefs);

  // Start building SVG
  const lines: string[] = [];
  lines.push(SVG_HEADER);
  lines.push(`<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${atlasWidth}" height="${atlasHeight}" viewBox="0 0 ${atlasWidth} ${atlasHeight}">`);
  lines.push('  <defs>');

  // Add all canonical definitions
  for (const hash of sortedHashes) {
    const canonicalDef = dedup.canonicalDefs.get(hash);
    if (!canonicalDef) continue;

    let content = rebuiltDefs.get(canonicalDef.id);
    if (!content) continue;

    content = fixSvgXml(content);
    if (opts.stripDefaults) {
      content = stripDefaultAttributes(content);
    }
    lines.push(indent(content, 4, opts.minify));
  }

  // Add clip paths for each frame
  for (let i = 0; i < uniqueSprites.length; i++) {
    const col = i % layout.columns;
    const row = Math.floor(i / layout.columns);
    const x = col * layout.cellWidth;
    const y = row * layout.cellHeight;
    lines.push(`    <clipPath id="clip_${i}"><rect x="${x}" y="${y}" width="${layout.cellWidth}" height="${layout.cellHeight}"/></clipPath>`);
  }

  lines.push('  </defs>');
  lines.push('');

  // Build atlas frames data and render each frame at its grid position
  // Use integer coordinates throughout to avoid sub-pixel jittering
  const atlasFrames: AtlasFrame[] = [];
  const duplicates: Record<string, string> = {};

  for (let i = 0; i < uniqueSprites.length; i++) {
    const sprite = uniqueSprites[i];
    const dim = frameDimensions[i];

    // Calculate grid position
    const col = i % layout.columns;
    const row = Math.floor(i / layout.columns);
    const x = col * layout.cellWidth;
    const y = row * layout.cellHeight;

    // Use integer cell dimensions for consistent positioning
    const frameWidth = layout.cellWidth;
    const frameHeight = layout.cellHeight;

    // Add to atlas frames manifest
    atlasFrames.push({
      id: sprite.id,
      x,
      y,
      width: frameWidth,
      height: frameHeight,
      offsetX: dim.minX,
      offsetY: dim.minY,
    });

    // Render frame content directly at grid position
    // Translate to position, then apply inverse of viewBox minX/minY to align content
    const translateX = x - dim.minX;
    const translateY = y - dim.minY;

    lines.push(`  <!-- Frame: ${sprite.id} -->`);
    lines.push(`  <g clip-path="url(#clip_${i})">`);
    lines.push(`    <g transform="translate(${translateX}, ${translateY})">`);

    // Apply the main transform if present
    if (sprite.mainTransform) {
      lines.push(`      <g transform="${escapeXml(sprite.mainTransform)}">`);
    }

    // Render use elements (filter out orphan references)
    const validUseElements = sprite.useElements.filter(hasValidReference);
    for (const use of validUseElements) {
      lines.push('        ' + renderUseElement(use, true));
    }

    if (sprite.mainTransform) {
      lines.push('      </g>');
    }
    lines.push('    </g>');
    lines.push('  </g>');
  }

  // Track duplicates
  for (const sprite of sprites) {
    if (sprite.duplicateOf) {
      duplicates[sprite.id] = sprite.duplicateOf;
    }
  }

  lines.push('</svg>');

  // Build manifest
  const animationName = uniqueSprites[0]?.animationName || 'unknown';
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

  const svg = opts.minify ? minifySvg(lines.join('\n')) : lines.join('\n');

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
  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate atlas
  const { svg, manifest } = generateAtlasSvg(frames, dedup, sprites, options);

  // Write atlas SVG
  const atlasPath = path.join(outputDir, 'atlas.svg');
  await Bun.write(atlasPath, svg);

  // Write atlas manifest
  const manifestPath = path.join(outputDir, 'atlas.json');
  const manifestJson = JSON.stringify(manifest, null, 2);
  await Bun.write(manifestPath, manifestJson);

  return {
    atlasSize: svg.length,
    manifestSize: manifestJson.length,
  };
}
