/**
 * Shared utilities for SVG spritesheet generation
 */
import { match, P } from 'ts-pattern';

/**
 * SVG void elements that should be self-closed
 */
export const SVG_VOID_ELEMENTS = new Set([
  'path', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'rect',
  'use', 'image', 'stop', 'animate', 'animateTransform', 'animateMotion',
  'set', 'mpath', 'feBlend', 'feColorMatrix', 'feComponentTransfer',
  'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap',
  'feFlood', 'feGaussianBlur', 'feImage', 'feMergeNode', 'feMorphology',
  'feOffset', 'feSpecularLighting', 'feTile', 'feTurbulence',
]);

/**
 * Escape XML special characters
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert HTML-style SVG to proper XML with self-closing tags
 */
export function fixSvgXml(html: string): string {
  let result = html;

  for (const tag of SVG_VOID_ELEMENTS) {
    // Match <tag followed by attributes, ending with > (not />)
    const pattern = new RegExp(`<${tag}(\\s[^>]*[^/])>`, 'gi');
    result = result.replace(pattern, `<${tag}$1/>`);

    // Handle <tag> with no attributes
    const emptyPattern = new RegExp(`<${tag}>`, 'gi');
    result = result.replace(emptyPattern, `<${tag}/>`);
  }

  return result;
}

/**
 * Reference type enumeration
 */
export type ReferenceType = 'xlink-href' | 'href' | 'url';

/**
 * Extract reference ID from a reference string
 */
export function extractReferenceId(ref: string): string | null {
  return match(ref)
    .with(P.string.startsWith('#'), (r) => r.slice(1))
    .with(P.string.includes('#'), (r) => r.split('#')[1] || null)
    .otherwise(() => null);
}

/**
 * Replace all reference types in content with mapped IDs
 * Handles: xlink:href="#id", href="#id", url(#id)
 */
export function replaceReferences(
  content: string,
  mapping: Map<string, string>
): string {
  // Replace xlink:href="#..."
  let result = content.replace(
    /xlink:href="#([^"]+)"/g,
    (original, id) => {
      const canonical = mapping.get(id);
      return canonical ? `xlink:href="#${canonical}"` : original;
    }
  );

  // Replace href="#..." (excluding xmlns declarations)
  result = result.replace(
    /href="#([^"]+)"(?!\s*xmlns)/g,
    (original, id) => {
      const canonical = mapping.get(id);
      return canonical ? `href="#${canonical}"` : original;
    }
  );

  // Replace url(#...)
  result = result.replace(
    /url\(#([^)]+)\)/g,
    (original, id) => {
      const canonical = mapping.get(id);
      return canonical ? `url(#${canonical})` : original;
    }
  );

  return result;
}

/**
 * Base64 data placeholder for safe normalization
 */
const BASE64_PLACEHOLDER_PREFIX = '__BASE64_PLACEHOLDER_';

/**
 * Extract base64 data from content and replace with placeholders
 * Returns the modified content and a map of placeholders to original data
 */
export function extractBase64Data(content: string): {
  content: string;
  base64Map: Map<string, string>;
} {
  const base64Map = new Map<string, string>();
  let index = 0;

  // Match data:image URIs (base64 encoded images)
  const result = content.replace(
    /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
    (match) => {
      const placeholder = `${BASE64_PLACEHOLDER_PREFIX}${index++}__`;
      base64Map.set(placeholder, match);
      return placeholder;
    }
  );

  return { content: result, base64Map };
}

/**
 * Restore base64 data from placeholders
 */
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

/**
 * Cache for deduplicated base64 images
 * Key: hash of base64 data, Value: canonical base64 string
 */
const base64Cache = new Map<string, string>();

/**
 * Get or cache a base64 image by its content
 * Returns the canonical (first seen) base64 string
 */
export function deduplicateBase64(base64Data: string, hash: string): string {
  const existing = base64Cache.get(hash);
  if (existing) {
    return existing;
  }
  base64Cache.set(hash, base64Data);
  return base64Data;
}

/**
 * Clear the base64 cache (call between sprite processing runs)
 */
export function clearBase64Cache(): void {
  base64Cache.clear();
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  return match(bytes)
    .when((b) => b < 1024, (b) => `${b} B`)
    .when((b) => b < 1024 * 1024, (b) => `${(b / 1024).toFixed(2)} KB`)
    .otherwise((b) => `${(b / 1024 / 1024).toFixed(2)} MB`);
}

/**
 * Round a number to specified precision
 */
export function roundToPrecision(value: number, precision: number): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Normalize numeric values in a string (for consistent hashing)
 * Handles values in attributes, transform functions, etc.
 */
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

/**
 * Sort attributes alphabetically within each XML tag
 */
export function sortTagAttributes(content: string): string {
  return content.replace(
    /<(\w+)([^>]*)>/g,
    (original, tag: string, attrs: string) => {
      if (!attrs.trim()) return original;

      const attrPairs: Array<[string, string]> = [];
      const attrRegex = /(\S+)="([^"]*)"/g;

      for (const attrMatch of attrs.matchAll(attrRegex)) {
        attrPairs.push([attrMatch[1], attrMatch[2]]);
      }

      attrPairs.sort((a, b) => a[0].localeCompare(b[0]));

      const sortedAttrs = attrPairs.map(([k, v]) => `${k}="${v}"`).join(' ');
      return sortedAttrs ? `<${tag} ${sortedAttrs}>` : `<${tag}>`;
    }
  );
}

/**
 * Serialize element attributes to string
 */
export function serializeAttributes(
  attrs: Array<{ name: string; value: string }>
): string {
  return attrs
    .map(({ name, value }) => `${name}="${escapeXml(value)}"`)
    .join(' ');
}

/**
 * Use element attribute builder
 */
export interface UseElementAttrs {
  href: string;
  width?: number;
  height?: number;
  transform?: string;
  additionalAttrs?: Record<string, string>;
}

/**
 * Build use element attribute string
 */
export function buildUseElementAttrs(attrs: UseElementAttrs): string {
  const parts: string[] = [`xlink:href="${escapeXml(attrs.href)}"`];

  if (attrs.width !== undefined) {
    parts.push(`width="${attrs.width}"`);
  }
  if (attrs.height !== undefined) {
    parts.push(`height="${attrs.height}"`);
  }
  if (attrs.transform) {
    parts.push(`transform="${escapeXml(attrs.transform)}"`);
  }

  if (attrs.additionalAttrs) {
    for (const [key, value] of Object.entries(attrs.additionalAttrs)) {
      parts.push(`${key}="${escapeXml(value)}"`);
    }
  }

  return parts.join(' ');
}
