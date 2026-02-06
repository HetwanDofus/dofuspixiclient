import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";

import type { Definition, ParsedFrame, PositioningOffset, UseElement, ViewBox } from "../types.ts";
import {
  extractBase64Data,
  normalizeNumericValues,
  restoreBase64Data,
  sortTagAttributes,
} from "./utils.ts";

type CheerioElement = ReturnType<CheerioAPI>;

/**
 * Parse a single SVG file into structured data
 */
export function parseSvgFile(content: string, filename: string): ParsedFrame {
  const $ = cheerio.load(content, { xml: true });
  const svg = $("svg");

  if (svg.length === 0) {
    throw new Error(`No <svg> element found in ${filename}`);
  }

  // Use viewBox if present, otherwise derive from width/height attributes
  const viewBoxAttr = svg.attr("viewBox");
  const viewBox = viewBoxAttr
    ? parseViewBox(viewBoxAttr)
    : deriveViewBoxFromDimensions(svg.attr("width"), svg.attr("height"));
  const mainGroup = svg.children("g").first();
  const mainTransform = mainGroup.attr("transform") ?? "";
  const positioningOffset = parseTransformOffset(mainTransform);

  const parent = mainGroup.length > 0 ? mainGroup : svg;
  const useElements = extractUseElements($, parent);

  const defs = svg.find("defs").first();
  const definitions = defs.length > 0 ? extractDefinitions($, defs) : [];

  const { animationName, frameIndex } = parseFilename(filename);

  return {
    filename,
    animationName,
    frameIndex,
    viewBox,
    mainTransform,
    positioningOffset,
    useElements,
    definitions,
  };
}

/**
 * Parse transform attribute to extract positioning offset (translation)
 * Handles: matrix(a, b, c, d, tx, ty) and translate(tx, ty)
 */
function parseTransformOffset(transform: string): PositioningOffset {
  if (!transform) {
    return { x: 0, y: 0 };
  }

  // Try matrix format: matrix(a, b, c, d, tx, ty)
  const matrixMatch = transform.match(/matrix\s*\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
  if (matrixMatch) {
    const tx = parseFloat(matrixMatch[5]);
    const ty = parseFloat(matrixMatch[6]);
    return { x: tx, y: ty };
  }

  // Try translate format: translate(tx, ty) or translate(tx)
  const translateMatch = transform.match(/translate\s*\(\s*([^,)]+)(?:,\s*([^)]+))?\)/);
  if (translateMatch) {
    const tx = parseFloat(translateMatch[1]);
    const ty = translateMatch[2] ? parseFloat(translateMatch[2]) : 0;
    return { x: tx, y: ty };
  }

  return { x: 0, y: 0 };
}

/**
 * Parse viewBox attribute string
 */
function parseViewBox(viewBoxStr: string): ViewBox {
  const parts = viewBoxStr.trim().split(/\s+/).map(Number);
  return {
    x: parts[0] || 0,
    y: parts[1] || 0,
    width: parts[2] || 100,
    height: parts[3] || 100,
  };
}

/**
 * Derive viewBox from width/height attributes when viewBox is not present
 * Handles values like "77.1px", "100", "50%" etc.
 */
function deriveViewBoxFromDimensions(
  widthAttr: string | undefined,
  heightAttr: string | undefined
): ViewBox {
  const parseLength = (val: string | undefined): number => {
    if (!val) return 100;
    // Remove px, em, pt, etc. and parse as float
    const num = parseFloat(val.replace(/[a-z%]+$/i, ""));
    return Number.isNaN(num) ? 100 : num;
  };

  return {
    x: 0,
    y: 0,
    width: parseLength(widthAttr),
    height: parseLength(heightAttr),
  };
}

/**
 * Parse filename to extract animation name and frame index
 * Pattern: {animationName}_{frameIndex}.svg
 */
function parseFilename(filename: string): {
  animationName: string;
  frameIndex: number;
} {
  const basename = filename.replace(/\.svg$/i, "");
  const filenameMatch = basename.match(/^(.+?)_(\d+)$/);

  if (filenameMatch?.[1] && filenameMatch[2]) {
    return {
      animationName: filenameMatch[1],
      frameIndex: parseInt(filenameMatch[2], 10),
    };
  }

  return {
    animationName: basename,
    frameIndex: 0,
  };
}

/**
 * Attributes to exclude from use element extraction
 * Note: 'id' is excluded to prevent ID leaking into the global namespace
 */
const USE_EXCLUDED_ATTRS = new Set([
  "xlink:href",
  "href",
  "transform",
  "width",
  "height",
  "id",
]);

/**
 * Extract all <use> elements from a parent element
 */
function extractUseElements(
  $: CheerioAPI,
  parent: CheerioElement
): UseElement[] {
  const result: UseElement[] = [];

  parent.find("use").each((_, el) => {
    const use = $(el);
    const href = use.attr("xlink:href") ?? use.attr("href") ?? "";
    const transform = use.attr("transform");
    const width = use.attr("width");
    const height = use.attr("height");

    const element: UseElement = {
      originalHref: href,
      attributes: {},
    };

    if (transform) element.transform = transform;
    if (width) element.width = parseFloat(width);
    if (height) element.height = parseFloat(height);

    // Extract non-standard attributes
    if ("attribs" in el) {
      const attrs = el.attribs as Record<string, string>;
      for (const [name, value] of Object.entries(attrs)) {
        if (!USE_EXCLUDED_ATTRS.has(name)) {
          element.attributes[name] = value;
        }
      }
    }

    result.push(element);
  });

  return result;
}

/**
 * Extract all definitions from <defs> section
 */
function extractDefinitions($: CheerioAPI, defs: CheerioElement): Definition[] {
  const definitions: Definition[] = [];

  defs.children().each((_, el) => {
    const def = extractDefinition($, $(el));
    if (def) {
      definitions.push(def);
    }
  });

  return definitions;
}

/**
 * Extract a single definition element
 */
function extractDefinition(
  $: CheerioAPI,
  element: CheerioElement
): Definition | null {
  const id = element.attr("id");
  if (!id) return null;

  const tagName = element.prop("tagName")?.toLowerCase() ?? "";
  const outerHTML = $.html(element);
  const normalizedContent = normalizeDefinitionContent(outerHTML);

  // Check for base64 image content
  // Can be in: <pattern>, <image>, or nested within other elements
  const isPattern = tagName === "pattern";
  const isImage = tagName === "image";
  let base64Data: string | undefined;

  if (isImage) {
    // Direct <image> element with base64
    const href = element.attr("xlink:href") ?? element.attr("href") ?? "";
    if (href.startsWith("data:image")) {
      base64Data = href;
    }
  } else {
    // Check for nested <image> elements with base64
    const image = element.find("image").first();
    if (image.length > 0) {
      const href = image.attr("xlink:href") ?? image.attr("href") ?? "";
      if (href.startsWith("data:image")) {
        base64Data = href;
      }
    }
  }

  // Elements with base64 data are self-contained and can be shared globally
  const hasBase64 = Boolean(base64Data);

  const nestedRefs = extractNestedRefs($, element);

  return {
    originalId: id,
    contentHash: "", // Will be computed during deduplication
    normalizedContent,
    tagName,
    size: normalizedContent.length,
    nestedRefs,
    isPattern: isPattern || (isImage && hasBase64), // Treat base64 images like patterns
    base64Data,
  };
}

/**
 * Extract nested references from a definition
 * Handles: <use href="#id">, url(#id) in attributes, etc.
 */
function extractNestedRefs($: CheerioAPI, element: CheerioElement): string[] {
  const refs: string[] = [];

  // Extract from <use> elements
  element.find("use").each((_, el) => {
    const use = $(el);
    const href = use.attr("xlink:href") ?? use.attr("href") ?? "";
    const refMatch = href.match(/^#(.+)$/);
    if (refMatch) {
      refs.push(refMatch[1]);
    }
  });

  // Extract url(#...) references from all elements (fill, stroke, clip-path, etc.)
  const html = $.html(element);
  const urlMatches = html.matchAll(/url\(#([^)]+)\)/g);
  for (const match of urlMatches) {
    refs.push(match[1]);
  }

  return [...new Set(refs)];
}

/**
 * Normalize definition content for consistent hashing
 * - Protects base64 data from modification
 * - Removes ID attribute
 * - Normalizes whitespace
 * - Rounds numeric values
 * - Sorts attributes alphabetically
 */
function normalizeDefinitionContent(
  content: string,
  precision: number = 2
): string {
  // Step 1: Extract base64 data to protect it from normalization
  const { content: safeContent, base64Map } = extractBase64Data(content);

  // Step 2: Remove ALL id attributes for content comparison (including nested ones)
  let normalized = safeContent.replace(/\s+id="[^"]*"/g, "");

  // Step 3: Normalize whitespace
  normalized = normalized.replace(/\s+/g, " ").trim();

  // Step 4: Round numeric values
  normalized = normalizeNumericValues(normalized, precision);

  // Step 5: Sort attributes within each tag
  normalized = sortTagAttributes(normalized);

  // Step 6: Restore base64 data
  normalized = restoreBase64Data(normalized, base64Map);

  return normalized;
}

/**
 * Format viewBox as string
 */
export function formatViewBox(viewBox: ViewBox): string {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

/**
 * Batch parse multiple SVG files
 */
export async function parseSvgFiles(
  filePaths: string[],
  onProgress?: (current: number, total: number) => void
): Promise<ParsedFrame[]> {
  const frames: ParsedFrame[] = [];
  const total = filePaths.length;

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const filename = filePath.split("/").pop() ?? filePath;

    try {
      const content = await Bun.file(filePath).text();
      const frame = parseSvgFile(content, filename);
      frames.push(frame);
    } catch (error) {
      console.error(`Failed to parse ${filename}:`, error);
    }

    onProgress?.(i + 1, total);
  }

  // Sort by animation name and frame index
  frames.sort((a, b) => {
    const nameCompare = a.animationName.localeCompare(b.animationName);
    return nameCompare !== 0 ? nameCompare : a.frameIndex - b.frameIndex;
  });

  return frames;
}
