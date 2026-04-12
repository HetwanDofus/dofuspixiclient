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

// ---------------------------------------------------------------------------
// 2D affine matrix utilities for transform composition
// ---------------------------------------------------------------------------

/** 2D affine matrix [a, b, c, d, tx, ty] */
type Matrix2D = [number, number, number, number, number, number];

const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0];

function parseTransformMatrix(transform: string | undefined): Matrix2D {
  if (!transform) return [...IDENTITY] as Matrix2D;

  const matrixMatch = transform.match(
    /matrix\s*\(\s*([^,)]+)[,\s]+([^,)]+)[,\s]+([^,)]+)[,\s]+([^,)]+)[,\s]+([^,)]+)[,\s]+([^,)]+)\s*\)/
  );
  if (matrixMatch) {
    return [
      parseFloat(matrixMatch[1]),
      parseFloat(matrixMatch[2]),
      parseFloat(matrixMatch[3]),
      parseFloat(matrixMatch[4]),
      parseFloat(matrixMatch[5]),
      parseFloat(matrixMatch[6]),
    ];
  }

  const translateMatch = transform.match(
    /translate\s*\(\s*([^,)]+)(?:[,\s]+([^,)]+))?\s*\)/
  );
  if (translateMatch) {
    return [1, 0, 0, 1, parseFloat(translateMatch[1]), translateMatch[2] ? parseFloat(translateMatch[2]) : 0];
  }

  const scaleMatch = transform.match(
    /scale\s*\(\s*([^,)]+)(?:[,\s]+([^,)]+))?\s*\)/
  );
  if (scaleMatch) {
    const sx = parseFloat(scaleMatch[1]);
    const sy = scaleMatch[2] ? parseFloat(scaleMatch[2]) : sx;
    return [sx, 0, 0, sy, 0, 0];
  }

  // Unsupported transform — return identity (safe fallback)
  return [...IDENTITY] as Matrix2D;
}

function composeMatrices(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  const [a1, b1, c1, d1, tx1, ty1] = m1;
  const [a2, b2, c2, d2, tx2, ty2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * tx2 + c1 * ty2 + tx1,
    b1 * tx2 + d1 * ty2 + ty1,
  ];
}

function matrixToTransformString(m: Matrix2D, precision: number = 2): string {
  const r = (n: number) => {
    const rounded = parseFloat(n.toFixed(precision));
    return rounded === 0 ? 0 : rounded; // avoid -0
  };
  const [a, b, c, d, tx, ty] = m.map(r);

  if (a === 1 && b === 0 && c === 0 && d === 1 && tx === 0 && ty === 0) return "";
  if (a === 1 && b === 0 && c === 0 && d === 1) {
    return ty === 0 ? `translate(${tx})` : `translate(${tx}, ${ty})`;
  }
  return `matrix(${a}, ${b}, ${c}, ${d}, ${tx}, ${ty})`;
}

// ---------------------------------------------------------------------------
// Wrapper definition flattening
// ---------------------------------------------------------------------------

/**
 * When a frame has a single top-level <use> pointing to a <g> wrapper definition
 * that only contains sub-<use> elements, flatten the wrapper by inlining the
 * sub-uses as top-level use elements with composed transforms.
 *
 * This exposes individual sub-elements to element-level deduplication, enabling
 * base/delta splitting (static background vs changing elements across frames).
 *
 * Transform composition: each sub-use gets transform = wrapperUse.T × wrapperDef.T × subUse.T
 * The mainTransform is unchanged (still applied as outer wrapper during rendering).
 */
function tryFlattenWrapperDefinition(
  $: CheerioAPI,
  parent: CheerioElement,
  defs: CheerioElement
): { useElements: UseElement[]; definitions: Definition[] } | null {
  if (!defs.length) return null;

  // Check for exactly 1 direct <use> child in the main group
  const directUses = parent.children("use");
  if (directUses.length !== 1) return null;

  const mainUse = $(directUses[0]);
  const href = mainUse.attr("xlink:href") ?? mainUse.attr("href") ?? "";
  const refMatch = href.match(/^#(.+)$/);
  if (!refMatch) return null;

  const wrapperDefId = refMatch[1];

  // Find the wrapper definition in defs — must be a <g>
  let wrapperEl: CheerioElement | null = null;
  defs.children().each((_, el) => {
    const elem = $(el);
    if (elem.attr("id") === wrapperDefId) {
      wrapperEl = elem;
    }
  });
  if (!wrapperEl) return null;

  const wrapperTag = (wrapperEl as CheerioElement).prop("tagName")?.toLowerCase();
  if (wrapperTag !== "g") return null;

  // Check all direct children are <use> elements
  const wrapperChildren = (wrapperEl as CheerioElement).children();
  let allUses = true;
  wrapperChildren.each((_, el) => {
    if ($(el).prop("tagName")?.toLowerCase() !== "use") allUses = false;
  });
  if (!allUses || wrapperChildren.length === 0) return null;

  // Compose parent transform: mainUse.transform × wrapperDef.transform
  const mainUseTransform = parseTransformMatrix(mainUse.attr("transform"));
  const wrapperGroupTransform = parseTransformMatrix((wrapperEl as CheerioElement).attr("transform"));
  const parentTransform = composeMatrices(mainUseTransform, wrapperGroupTransform);

  // Extract sub-use elements with composed transforms
  const flattenedUses: UseElement[] = [];
  wrapperChildren.each((_, el) => {
    const subUse = $(el);
    const subHref = subUse.attr("xlink:href") ?? subUse.attr("href") ?? "";
    const subTransform = parseTransformMatrix(subUse.attr("transform"));
    const composed = composeMatrices(parentTransform, subTransform);
    const composedStr = matrixToTransformString(composed);

    const element: UseElement = {
      originalHref: subHref,
      attributes: {},
    };

    if (composedStr) element.transform = composedStr;

    const width = subUse.attr("width");
    const height = subUse.attr("height");
    if (width) element.width = parseFloat(width);
    if (height) element.height = parseFloat(height);

    // Non-standard attributes
    if ("attribs" in el) {
      const attrs = el.attribs as Record<string, string>;
      for (const [name, value] of Object.entries(attrs)) {
        if (!USE_EXCLUDED_ATTRS.has(name)) {
          element.attributes[name] = value;
        }
      }
    }

    flattenedUses.push(element);
  });

  // Remove wrapper def from DOM and extract remaining definitions
  (wrapperEl as CheerioElement).remove();
  const definitions = extractDefinitions($, defs);

  return { useElements: flattenedUses, definitions };
}

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
  const defs = svg.find("defs").first();

  // Try to flatten wrapper definitions for better element-level dedup
  const flattened = tryFlattenWrapperDefinition($, parent, defs);

  const useElements = flattened?.useElements ?? extractUseElements($, parent);
  const definitions = flattened?.definitions ?? (defs.length > 0 ? extractDefinitions($, defs) : []);

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

  // Try matrix format: matrix(a, b, c, d, tx, ty) — comma or space separated
  const matrixMatch = transform.match(/matrix\s*\(\s*([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^)\s]+)\s*\)/);
  if (matrixMatch) {
    const tx = parseFloat(matrixMatch[5]);
    const ty = parseFloat(matrixMatch[6]);
    return { x: tx, y: ty };
  }

  // Try translate format: translate(tx, ty) or translate(tx ty) or translate(tx)
  // SVG allows both comma and space as separator
  const translateMatch = transform.match(/translate\s*\(\s*([^,\s)]+)[\s,]*([^)]*)\)/);
  if (translateMatch) {
    const tx = parseFloat(translateMatch[1]);
    const ty = translateMatch[2]?.trim() ? parseFloat(translateMatch[2]) : 0;
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
 * Extract all definitions from <defs> section.
 * After extraction, resolves intra-defs <use> references: when a definition
 * contains <use xlink:href="#X"> and #X is an element defined inside a sibling
 * definition (e.g. an <image> inside a <pattern>), inline the referenced
 * content so the definition is self-contained.
 */
function extractDefinitions($: CheerioAPI, defs: CheerioElement): Definition[] {
  // First pass: build a map of id → element content for all elements with ids
  // (including nested ones like <image id="..."> inside <pattern>)
  const idContentMap = new Map<string, string>();
  defs.find("[id]").each((_, el) => {
    const elem = $(el);
    const id = elem.attr("id");
    if (id) {
      // Get the outer HTML without the id attribute for inlining
      const clone = elem.clone();
      clone.removeAttr("id");
      idContentMap.set(id, $.html(clone));
    }
  });

  // Second pass: resolve intra-defs <use> refs that point to NESTED elements
  // (elements defined inside a sibling def, not top-level defs children).
  // Top-level defs children get their own canonical IDs during deduplication,
  // so <use> refs to them are properly remapped — inlining those would destroy
  // cross-frame definition sharing.
  // Only inline when the target is nested (e.g. <image> inside <pattern>,
  // or <g> inside another <g>).
  // Repeat until no more inlining happens (handles chained refs).
  const topLevelDefIds = new Set<string>();
  defs.children().each((_, el) => {
    const id = $(el).attr("id");
    if (id) topLevelDefIds.add(id);
  });

  let changed = true;
  while (changed) {
    changed = false;
    defs.children().each((_, el) => {
      const element = $(el);
      const ownId = element.attr("id");
      element.find("use").each((_, useEl) => {
        const use = $(useEl);
        const href = use.attr("xlink:href") ?? use.attr("href") ?? "";
        const refMatch = href.match(/^#(.+)$/);
        if (!refMatch) return;

        const refId = refMatch[1];
        if (refId === ownId) return; // skip self-refs

        // Only inline local refs (not canonical refs from previous processing)
        if (refId.startsWith("def_") || /^d\d+$/.test(refId)) return;

        // Don't inline top-level defs — they get canonical IDs and are shared
        if (topLevelDefIds.has(refId)) return;

        const targetContent = idContentMap.get(refId);
        if (targetContent) {
          // Preserve the <use> element's transform by wrapping the inlined
          // content in a <g> with the use's transform. Without this, the
          // target content's own transform gets applied without the use's
          // compensating transform, causing incorrect positioning.
          const useTransform = use.attr("transform");
          if (useTransform) {
            use.replaceWith(`<g transform="${useTransform}">${targetContent}</g>`);
          } else {
            use.replaceWith(targetContent);
          }
          changed = true;
        }
      });
    });
  }

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
  // Full-precision content used for the final atlas output. IDs are stripped
  // later in rebuildDefinitionContent, so we keep them here.
  const originalContent = outerHTML;
  // Aggressively normalized (rounded) version used only for content hashing
  // during dedup. Never written to the atlas — `originalContent` is.
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
    originalContent,
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
