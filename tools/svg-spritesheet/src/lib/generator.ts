/**
 * Generator - Output generation for defs.svg and sprites.svg
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  DeduplicationResult,
  ProcessedSprite,
  UseElement,
} from '../types.ts';
import {
  buildCanonicalDefinitions,
  sortDefinitionsTopologically,
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

/**
 * Indentation helper
 */
function indent(content: string, spaces: number): string {
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
  indentLevel: number = 4
): string[] {
  const rebuiltDefs = buildCanonicalDefinitions(frames, dedup);
  const sortedHashes = sortDefinitionsTopologically(dedup.canonicalDefs, rebuiltDefs);
  const lines: string[] = [];

  for (const hash of sortedHashes) {
    const canonicalDef = dedup.canonicalDefs.get(hash);
    if (!canonicalDef) continue;

    const content = rebuiltDefs.get(canonicalDef.id);
    if (!content) continue;

    const fixedContent = fixSvgXml(content);
    lines.push(indent(fixedContent, indentLevel));
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
  // If canonicalHref starts with #def_, it was properly mapped
  // If it still has the original short ID (like #n, #p, #t), it's orphan
  return href.startsWith('#def_') || !href.startsWith('#');
}

/**
 * Render a sprite symbol
 */
function renderSymbol(
  sprite: ProcessedSprite,
  useInternalRefs: boolean
): string[] {
  const lines: string[] = [];

  lines.push(`  <symbol id="${escapeXml(sprite.id)}" viewBox="${sprite.viewBox}">`);

  // Determine indentation based on whether we have a main group
  const hasMainGroup = Boolean(sprite.mainTransform);
  const useIndent = hasMainGroup ? '      ' : '    ';

  if (hasMainGroup) {
    lines.push(`    <g transform="${escapeXml(sprite.mainTransform)}">`);
  }

  // Filter out use elements with orphan references (those that don't exist in defs)
  const validUseElements = sprite.useElements.filter(hasValidReference);

  for (const use of validUseElements) {
    lines.push(useIndent + renderUseElement(use, useInternalRefs));
  }

  if (hasMainGroup) {
    lines.push('    </g>');
  }

  lines.push('  </symbol>');

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
  sprites: ProcessedSprite[]
): string {
  const lines: string[] = [
    SVG_HEADER,
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">`,
    '  <defs>',
  ];

  // Add definitions
  lines.push(...generateDefsContent(frames, dedup));

  lines.push('  </defs>');
  lines.push('');

  // Add symbols for each frame
  for (const sprite of sprites) {
    if (sprite.duplicateOf) continue;

    lines.push(...renderSymbol(sprite, true));
  }

  lines.push('</svg>');

  return lines.join('\n');
}

/**
 * Write output files to directory
 */
export async function writeOutput(
  outputDir: string,
  frames: ParsedFrame[],
  dedup: DeduplicationResult,
  sprites: ProcessedSprite[]
): Promise<{ defsSize: number; spritesSize: number; combinedSize: number }> {
  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate and write defs.svg (for reference/debugging)
  const defsSvg = generateDefsSvg(frames, dedup);
  const defsPath = path.join(outputDir, 'defs.svg');
  await Bun.write(defsPath, defsSvg);

  // Generate and write sprites.svg (standalone symbols, for reference)
  const spritesSvg = generateSpritesSvg(sprites, true);
  const spritesPath = path.join(outputDir, 'sprites.svg');
  await Bun.write(spritesPath, spritesSvg);

  // Generate and write combined spritesheet.svg (main output file)
  const combinedSvg = generateCombinedSvg(frames, dedup, sprites);
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
