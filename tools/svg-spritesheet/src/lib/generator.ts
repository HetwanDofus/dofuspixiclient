import * as fs from "node:fs";
import * as path from "node:path";

import type { Element } from "domhandler";
import * as cheerio from "cheerio";

import type {
  AtlasFrame,
  AtlasManifest,
  DeduplicationResult,
  ElementDeduplicationResult,
  ElementRef,
  OptimizationOptions,
  ParsedFrame,
  ProcessedSprite,
  UseElement,
} from "../types.ts";
import type { ImageRegistry } from "./image-exporter.ts";
import {
  buildCanonicalDefinitions,
  deduplicateElements,
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
 * Replace stroke-width with __RESOLUTION__ placeholder for elements that use
 * or inherit non-scaling-stroke, but only when stroke-width is the default
 * value (1 or 1px). Uses cheerio for proper DOM traversal so
 * inherited stroke-width from any ancestor depth is handled correctly.
 */
function processNonScalingStroke(content: string): string {
  const $ = cheerio.load(content, { xml: true });

  // Find all elements with vector-effect="non-scaling-stroke"
  const nonScalingEls = $('[vector-effect="non-scaling-stroke"]');

  if (nonScalingEls.length === 0) {
    return content;
  }

  // Only replace default stroke-width values
  const is1OfSize = (v: string) => v === "1" || v === "1px";

  // Collect all ancestors that provide inherited stroke-width
  const ancestorsToFix = new Set<Element>();

  nonScalingEls.each((_, el) => {
    const $el = $(el);

    // If the element itself has stroke-width, replace directly
    const sw = $el.attr("stroke-width");

    if (sw) {
      if (is1OfSize(sw)) $el.attr("stroke-width", "__RESOLUTION__");

      return;
    }

    // Walk up ancestors to find the one providing stroke-width
    $el.parents().each((__, parent) => {
      const $parent = $(parent);
      const psw = $parent.attr("stroke-width");

      if (psw) {
        if (is1OfSize(psw)) ancestorsToFix.add(parent);

        return false; // stop at the nearest ancestor with stroke-width either way
      }
    });
  });

  ancestorsToFix.forEach((ancestor) => {
    $(ancestor).attr("stroke-width", "__RESOLUTION__");
  });

  return $.xml();
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
function extractTranslation(transform: string | undefined): {
  x: number;
  y: number;
} {
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

/**
 * Compute frame bounds from viewBox.
 *
 * Previously this tried to compute tight bounds from use element positions,
 * but that only extracted translation offsets and ignored rotation/scale/matrix
 * transforms, causing frames to be clipped. Using the full viewBox is correct
 * and matches the original working output.
 */
function computeContentBounds(
  _sprite: ProcessedSprite,
  vbMinX: number,
  vbMinY: number,
  vbWidth: number,
  vbHeight: number
): { minX: number; minY: number; width: number; height: number } {
  return { minX: vbMinX, minY: vbMinY, width: vbWidth, height: vbHeight };
}

/**
 * Parse a transform string into a 2×3 affine matrix [a, b, c, d, tx, ty].
 */
function parseMatrix(
  transform: string | undefined
): [number, number, number, number, number, number] {
  if (!transform) return [1, 0, 0, 1, 0, 0];

  const m = transform.match(
    /matrix\s*\(\s*([^,)\s]+)[,\s]+([^,)\s]+)[,\s]+([^,)\s]+)[,\s]+([^,)\s]+)[,\s]+([^,)\s]+)[,\s]+([^,)\s]+)\s*\)/
  );
  if (m) {
    return [
      parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]),
      parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6]),
    ];
  }

  const t = transform.match(/translate\s*\(\s*([^,)\s]+)(?:[,\s]+([^,)\s]+))?\s*\)/);
  if (t) {
    return [1, 0, 0, 1, parseFloat(t[1]), t[2] ? parseFloat(t[2]) : 0];
  }

  const s = transform.match(/scale\s*\(\s*([^,)\s]+)(?:[,\s]+([^,)\s]+))?\s*\)/);
  if (s) {
    const sx = parseFloat(s[1]);
    return [sx, 0, 0, s[2] ? parseFloat(s[2]) : sx, 0, 0];
  }

  const r = transform.match(
    /rotate\s*\(\s*([^,)\s]+)(?:[,\s]+([^,)\s]+)[,\s]+([^,)\s]+))?\s*\)/
  );
  if (r) {
    const angle = (parseFloat(r[1]) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    if (r[2] && r[3]) {
      const cx = parseFloat(r[2]);
      const cy = parseFloat(r[3]);
      return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    }
    return [cos, sin, -sin, cos, 0, 0];
  }

  return [1, 0, 0, 1, 0, 0];
}

/**
 * Compute the axis-aligned bounding box of a use element after its transform.
 * Transforms the 4 corners of (0,0,width,height) through the affine matrix
 * and returns the enclosing AABB.
 */
function computeElementAABB(
  use: UseElement,
  mainTransform: string
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (use.width == null || use.height == null) return null;

  const [ma, mb, mc, md, mtx, mty] = parseMatrix(mainTransform);
  const [ea, eb, ec, ed, etx, ety] = parseMatrix(use.transform);

  // Compose: main × element
  const a = ma * ea + mc * eb;
  const b = mb * ea + md * eb;
  const c = ma * ec + mc * ed;
  const d = mb * ec + md * ed;
  const tx = ma * etx + mc * ety + mtx;
  const ty = mb * etx + md * ety + mty;

  // Transform 4 corners of (0, 0, w, h)
  const w = use.width;
  const h = use.height;
  const corners = [
    [tx, ty],
    [a * w + tx, b * w + ty],
    [c * h + tx, d * h + ty],
    [a * w + c * h + tx, b * w + d * h + ty],
  ];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cy] of corners) {
    minX = Math.min(minX, cx);
    minY = Math.min(minY, cy);
    maxX = Math.max(maxX, cx);
    maxY = Math.max(maxY, cy);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Compute the union AABB of multiple use elements, clamped to the viewBox.
 */
function computeElementsAABB(
  uses: UseElement[],
  mainTransform: string,
  vbMinX: number,
  vbMinY: number,
  vbWidth: number,
  vbHeight: number
): { minX: number; minY: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const use of uses) {
    const aabb = computeElementAABB(use, mainTransform);
    if (!aabb) {
      // Can't compute bounds — fall back to full viewBox
      return { minX: vbMinX, minY: vbMinY, width: vbWidth, height: vbHeight };
    }
    minX = Math.min(minX, aabb.minX);
    minY = Math.min(minY, aabb.minY);
    maxX = Math.max(maxX, aabb.maxX);
    maxY = Math.max(maxY, aabb.maxY);
  }

  if (!isFinite(minX)) {
    return { minX: vbMinX, minY: vbMinY, width: vbWidth, height: vbHeight };
  }

  // Clamp to viewBox with 1px margin
  minX = Math.max(Math.floor(minX) - 1, vbMinX);
  minY = Math.max(Math.floor(minY) - 1, vbMinY);
  maxX = Math.min(Math.ceil(maxX) + 1, vbMinX + vbWidth);
  maxY = Math.min(Math.ceil(maxY) + 1, vbMinY + vbHeight);

  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Render a pooled element reference.
 * - Inlined: render the full <use> element inline (same as before)
 * - Pooled: render <use xlink:href="#eN"/>
 * - Flipped: render <g transform="scale(-1,1)"><use xlink:href="#eN"/></g>
 */
function renderElementRef(
  ref: ElementRef,
  elemDedup: ElementDeduplicationResult,
  sprite: ProcessedSprite,
  refIndex: number
): string {
  const instance = elemDedup.pool.get(ref.hash);
  if (!instance) return "";

  // Inlined: render full use element as before
  if (ref.inlined) {
    const use = sprite.useElements.filter(hasValidReference)[refIndex];
    if (!use) return "";
    return renderUseElement(use, true);
  }

  // Pooled reference
  const useRef = `<use xlink:href="#${instance.id}"/>`;

  if (ref.flipped) {
    return `<g transform="scale(-1,1)">${useRef}</g>`;
  }

  return useRef;
}

/** Helper: render a frame group into the atlas */
function renderFrameGroup(
  lines: string[],
  clipId: string,
  translateX: number,
  translateY: number,
  mainTransform: string,
  elements: string[]
): void {
  lines.push(`  <g clip-path="url(#${clipId})">`);
  lines.push(`    <g transform="translate(${translateX}, ${translateY})">`);
  if (mainTransform) {
    lines.push(`      <g transform="${mainTransform}">`);
  }
  for (const el of elements) {
    lines.push("        " + el);
  }
  if (mainTransform) {
    lines.push("      </g>");
  }
  lines.push("    </g>");
  lines.push("  </g>");
}

/** Minimum base element ratio to trigger base/delta splitting */
const BASE_DELTA_MIN_BASE_RATIO = 0.3;
const BASE_DELTA_MIN_FRAMES = 3;

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

  // --- Element-level deduplication ---
  const elemDedup = deduplicateElements(sprites);

  // --- Decide base/delta splitting (z-order safe) ---
  // Try two strategies and pick the one that captures more base elements:
  //   "above": base elements above the highest delta → base composited on top
  //   "below": base elements below the lowest delta → base composited below
  const firstSprite = uniqueSprites[0];
  const firstFrameRefs = firstSprite ? elemDedup.frameElements.get(firstSprite.id) : undefined;
  const totalElementsPerFrame = firstFrameRefs?.length ?? 0;

  // Find delta z-range
  let lowestDeltaZ = totalElementsPerFrame;
  let highestDeltaZ = -1;
  if (firstFrameRefs) {
    for (let z = 0; z < firstFrameRefs.length; z++) {
      const ref = firstFrameRefs[z];
      if (!elemDedup.baseElementHashes.has(ref.hash) || ref.flipped) {
        if (z < lowestDeltaZ) lowestDeltaZ = z;
        if (z > highestDeltaZ) highestDeltaZ = z;
      }
    }
  }

  // Strategy "above": base elements above highest delta
  const aboveIndices = new Set<number>();
  if (firstFrameRefs && highestDeltaZ >= 0) {
    for (let z = highestDeltaZ + 1; z < firstFrameRefs.length; z++) {
      const ref = firstFrameRefs[z];
      if (elemDedup.baseElementHashes.has(ref.hash) && !ref.flipped) {
        aboveIndices.add(z);
      }
    }
  }

  // Strategy "below": base elements below lowest delta
  const belowIndices = new Set<number>();
  if (firstFrameRefs && lowestDeltaZ < totalElementsPerFrame) {
    for (let z = 0; z < lowestDeltaZ; z++) {
      const ref = firstFrameRefs[z];
      if (elemDedup.baseElementHashes.has(ref.hash) && !ref.flipped) {
        belowIndices.add(z);
      }
    }
  }

  // Pick the strategy with more base elements
  let splitBaseIndices: Set<number>;
  let splitZOrder: "above" | "below";
  if (aboveIndices.size >= belowIndices.size) {
    splitBaseIndices = aboveIndices;
    splitZOrder = "above";
  } else {
    splitBaseIndices = belowIndices;
    splitZOrder = "below";
  }

  // Rename for consistency with the rest of the function
  const aboveBaseIndices = splitBaseIndices;
  const aboveBaseCount = splitBaseIndices.size;
  const aboveBaseRatio = totalElementsPerFrame > 0 ? aboveBaseCount / totalElementsPerFrame : 0;
  const useBaseDelta =
    uniqueSprites.length >= BASE_DELTA_MIN_FRAMES &&
    aboveBaseRatio >= BASE_DELTA_MIN_BASE_RATIO &&
    aboveBaseCount > 0;

  // Parse viewBox once (shared by all frames in an animation)
  const vbParts = firstSprite ? firstSprite.viewBox.split(/\s+/).map(Number) : [0, 0, 100, 100];
  const vbMinX = vbParts[0] || 0;
  const vbMinY = vbParts[1] || 0;
  const vbWidth = vbParts[2] || 100;
  const vbHeight = vbParts[3] || 100;

  // Get positioning offset from first frame
  const firstFrame = frames[0];
  const positioningOffsetX = firstFrame ? -firstFrame.positioningOffset.x : 0;
  const positioningOffsetY = firstFrame ? -firstFrame.positioningOffset.y : 0;

  // --- Build pack rectangles ---
  const packRects: PackRect[] = [];
  const dimMap = new Map<string, FrameDimension>();

  // Delta-content dedup: maps sprite id → canonical sprite id when deltas are identical
  const deltaDuplicates = new Map<string, string>();

  if (useBaseDelta) {
    // Base frame: full viewBox
    const baseId = "__base__";
    packRects.push({ id: baseId, width: Math.ceil(vbWidth), height: Math.ceil(vbHeight) });
    dimMap.set(baseId, { id: baseId, index: -1, minX: vbMinX, minY: vbMinY, width: vbWidth, height: vbHeight });

    // Hash delta content per frame for delta-level dedup
    const deltaHashToCanonical = new Map<string, string>();

    // Delta frames: compute tight bounds from delta elements only
    for (let i = 0; i < uniqueSprites.length; i++) {
      const sprite = uniqueSprites[i];
      const refs = elemDedup.frameElements.get(sprite.id);
      if (!refs) continue;

      // Collect delta element refs and use elements
      const deltaRefHashes: string[] = [];
      const deltaUses: UseElement[] = [];
      const validUses = sprite.useElements.filter(hasValidReference);
      for (let j = 0; j < refs.length; j++) {
        if (!aboveBaseIndices.has(j)) {
          deltaRefHashes.push(refs[j].hash + (refs[j].flipped ? "_f" : ""));
          if (validUses[j]) deltaUses.push(validUses[j]);
        }
      }

      // Hash the delta content for dedup
      const deltaHash = deltaRefHashes.join("|");
      const existingCanonical = deltaHashToCanonical.get(deltaHash);

      if (existingCanonical) {
        // This delta is identical to an already-seen delta — mark as duplicate
        deltaDuplicates.set(sprite.id, existingCanonical);
        continue;
      }

      deltaHashToCanonical.set(deltaHash, sprite.id);

      let bounds: { minX: number; minY: number; width: number; height: number };
      if (deltaUses.length === 0) {
        bounds = { minX: vbMinX, minY: vbMinY, width: 1, height: 1 };
      } else {
        bounds = computeElementsAABB(deltaUses, sprite.mainTransform, vbMinX, vbMinY, vbWidth, vbHeight);
      }

      packRects.push({ id: sprite.id, width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) });
      dimMap.set(sprite.id, { id: sprite.id, index: i, minX: bounds.minX, minY: bounds.minY, width: bounds.width, height: bounds.height });
    }
  } else {
    // No splitting — full frames as before
    for (let i = 0; i < uniqueSprites.length; i++) {
      const sprite = uniqueSprites[i];
      packRects.push({ id: sprite.id, width: Math.ceil(vbWidth), height: Math.ceil(vbHeight) });
      dimMap.set(sprite.id, { id: sprite.id, index: i, minX: vbMinX, minY: vbMinY, width: vbWidth, height: vbHeight });
    }
  }

  // Pack rectangles
  const packResult = packRectangles(packRects, 1, 4096);
  const atlasWidth = packResult.width;
  const atlasHeight = packResult.height;

  const packedPositions: PackedPositionMap = new Map();
  for (const packed of packResult.rects) {
    packedPositions.set(packed.id, packed);
  }

  // --- Build SVG ---
  const rebuiltDefs = buildCanonicalDefinitions(frames, dedup, svgOutputDir, imageRegistry);
  const sortedHashes = sortDefinitionsTopologically(dedup.canonicalDefs, rebuiltDefs);

  const lines: string[] = [];
  lines.push(SVG_HEADER);
  lines.push(
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${atlasWidth}" height="${atlasHeight}" viewBox="0 0 ${atlasWidth} ${atlasHeight}">`
  );
  lines.push("  <defs>");

  // Emit definition-level deduped content
  for (const hash of sortedHashes) {
    const canonicalDef = dedup.canonicalDefs.get(hash);
    if (!canonicalDef) continue;
    let content = rebuiltDefs.get(canonicalDef.id);
    if (!content) continue;
    content = processNonScalingStroke(content);
    if (opts.stripDefaults) content = stripDefaultAttributes(content);
    lines.push(indent(content, 4, opts.minify));
  }

  // Emit pooled element instance groups
  const flipSources = new Set(elemDedup.flipPairs.values());
  for (const [hash, instance] of elemDedup.pool) {
    const isInlined = instance.occurrences < 2 && !instance.flipSourceHash;
    if (isInlined && !flipSources.has(hash)) continue;

    const useStr = `<use ${buildUseElementAttrs({
      href: toInternalRef(instance.href),
      width: instance.width,
      height: instance.height,
      transform: instance.transform,
      additionalAttrs: instance.attributes,
    })}/>`;
    lines.push(`    <g id="${instance.id}">${useStr}</g>`);
  }

  // Emit clip paths
  let clipIndex = 0;
  const clipIds = new Map<string, string>();

  if (useBaseDelta) {
    // Clip for base frame
    const basePacked = packedPositions.get("__base__");
    if (basePacked) {
      const cid = `clip_${clipIndex++}`;
      clipIds.set("__base__", cid);
      lines.push(`    <clipPath id="${cid}"><rect x="${basePacked.x}" y="${basePacked.y}" width="${basePacked.width}" height="${basePacked.height}"/></clipPath>`);
    }
  }
  for (const sprite of uniqueSprites) {
    const packed = packedPositions.get(sprite.id);
    if (!packed) continue;
    const cid = `clip_${clipIndex++}`;
    clipIds.set(sprite.id, cid);
    lines.push(`    <clipPath id="${cid}"><rect x="${packed.x}" y="${packed.y}" width="${packed.width}" height="${packed.height}"/></clipPath>`);
  }

  lines.push("  </defs>");
  lines.push("");

  // --- Render frames ---
  const atlasFrames: AtlasFrame[] = [];
  const duplicates: Record<string, string> = {};
  let baseFrameManifest: AtlasFrame | undefined;

  if (useBaseDelta) {
    // Render base frame (only base elements)
    const basePacked = packedPositions.get("__base__");
    const baseDim = dimMap.get("__base__");
    const baseClip = clipIds.get("__base__");
    if (basePacked && baseDim && baseClip && firstSprite && firstFrameRefs) {
      baseFrameManifest = {
        id: "__base__",
        x: basePacked.x, y: basePacked.y,
        width: basePacked.width, height: basePacked.height,
        offsetX: baseDim.minX, offsetY: baseDim.minY,
      };

      const baseElements: string[] = [];
      const validUses = firstSprite.useElements.filter(hasValidReference);
      for (let j = 0; j < firstFrameRefs.length; j++) {
        if (aboveBaseIndices.has(j)) {
          const ref = firstFrameRefs[j];
          const rendered = renderElementRef(ref, elemDedup, firstSprite, j);
          if (rendered) baseElements.push(rendered);
        }
      }

      const translateX = basePacked.x - baseDim.minX;
      const translateY = basePacked.y - baseDim.minY;
      lines.push(`  <!-- Base frame -->`);
      renderFrameGroup(lines, baseClip, translateX, translateY, firstSprite.mainTransform, baseElements);
    }

    // Render delta frames (only non-base elements), skipping delta-duplicates
    for (let i = 0; i < uniqueSprites.length; i++) {
      const sprite = uniqueSprites[i];

      // Delta-duplicate: point to canonical delta's atlas entry
      const deltaCanonical = deltaDuplicates.get(sprite.id);
      if (deltaCanonical) {
        duplicates[sprite.id] = deltaCanonical;
        continue;
      }

      const dim = dimMap.get(sprite.id);
      const packed = packedPositions.get(sprite.id);
      const clip = clipIds.get(sprite.id);
      const refs = elemDedup.frameElements.get(sprite.id);
      if (!dim || !packed || !clip) continue;

      atlasFrames.push({
        id: sprite.id,
        x: packed.x, y: packed.y,
        width: packed.width, height: packed.height,
        offsetX: dim.minX, offsetY: dim.minY,
      });

      const deltaElements: string[] = [];
      if (refs) {
        for (let j = 0; j < refs.length; j++) {
          if (!aboveBaseIndices.has(j)) {
            const rendered = renderElementRef(refs[j], elemDedup, sprite, j);
            if (rendered) deltaElements.push(rendered);
          }
        }
      }

      const translateX = packed.x - dim.minX;
      const translateY = packed.y - dim.minY;
      lines.push(`  <!-- Delta: ${sprite.id} -->`);
      renderFrameGroup(lines, clip, translateX, translateY, sprite.mainTransform, deltaElements);
    }
  } else {
    // No splitting — full frames
    for (let i = 0; i < uniqueSprites.length; i++) {
      const sprite = uniqueSprites[i];
      const dim = dimMap.get(sprite.id);
      const packed = packedPositions.get(sprite.id);
      const clip = clipIds.get(sprite.id);
      if (!dim || !packed || !clip) continue;

      atlasFrames.push({
        id: sprite.id,
        x: packed.x, y: packed.y,
        width: packed.width, height: packed.height,
        offsetX: dim.minX, offsetY: dim.minY,
      });

      const translateX = packed.x - dim.minX;
      const translateY = packed.y - dim.minY;
      const elements: string[] = [];
      const frameRefs = elemDedup.frameElements.get(sprite.id);
      if (frameRefs) {
        for (let j = 0; j < frameRefs.length; j++) {
          const rendered = renderElementRef(frameRefs[j], elemDedup, sprite, j);
          if (rendered) elements.push(rendered);
        }
      } else {
        for (const use of sprite.useElements.filter(hasValidReference)) {
          elements.push(renderUseElement(use, true));
        }
      }

      lines.push(`  <!-- Frame: ${sprite.id} -->`);
      renderFrameGroup(lines, clip, translateX, translateY, sprite.mainTransform, elements);
    }
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
    elementDedup: elemDedup.stats,
    baseFrame: baseFrameManifest,
    baseZOrder: useBaseDelta ? splitZOrder : undefined,
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
