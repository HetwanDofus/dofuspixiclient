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

/** Extract base64 data from content and replace with placeholders */
export function extractBase64Data(content: string): {
  content: string;
  base64Map: Map<string, string>;
} {
  const base64Map = new Map<string, string>();
  let index = 0;

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
    /<(\w+)([^>]*)>/g,
    (original, tag: string, attrs: string) => {
      if (!attrs.trim()) return original;

      const attrPairs: Array<[string, string]> = [];
      const attrRegex = /(\S+)="([^"]*)"/g;

      for (const attrMatch of attrs.matchAll(attrRegex)) {
        attrPairs.push([attrMatch[1], attrMatch[2]]);
      }

      attrPairs.sort((a, b) => a[0].localeCompare(b[0]));

      const sortedAttrs = attrPairs.map(([k, v]) => `${k}="${v}"`).join(" ");
      return sortedAttrs ? `<${tag} ${sortedAttrs}>` : `<${tag}>`;
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
