import { load } from "cheerio";
import type { Element } from "domhandler";

import { writeBinary } from "./binary-writer.ts";
import { applyColorZones } from "./color-mapper.ts";
import { deduplicate } from "./deduplicator.ts";
import { extractImages } from "./image-extractor.ts";
import { parseSvg } from "./svg-parser.ts";
import type {
  AffineTransform,
  AtlasJson,
  ExtrasPayload,
  ParsedAccessorySlot,
  ParsedFrame,
  ParsedFrameUse,
  ParsedSvg,
  SpriteMetadata,
} from "./types.ts";
import { IDENTITY_TRANSFORM, TintMode } from "./types.ts";

const STATIC_ANIMATION_NAME = "static";

export interface CompileStaticOptions {
  assetId: number;
  extras?: ExtrasPayload;
  /**
   * Optional color-zone metadata extracted from the source SWF (GAC.applyColor
   * walker). When present, the binary's ColorZoneTable gets populated so the
   * renderer can apply player/guild/spell/alignment-level HSL replacement.
   */
  metadata?: SpriteMetadata | null;
  /** Zone tint mode to stamp on every zone (defaults to Player). */
  tintMode?: TintMode;
  /**
   * Override the synthetic animation name baked into the binary's Animation
   * table. Tile-consumers (tile-vello-renderer) hardcode `"tile"` when
   * requesting frames, so staticTile categories pass that here to route their
   * single-frame output through the tile loader.
   */
  animationName?: string;
}

export interface CompileStaticResult {
  bytes: Uint8Array;
  stats: {
    uniquePaths: number;
    drawCommands: number;
    bodyParts: number;
    transforms: number;
    frames: number;
    images: number;
  };
}

/**
 * Compile a single-frame static shape (item icon, emblem, alignment icon, etc.)
 * into a .dofasset binary.
 *
 * Static SVGs differ from sprite atlases: no <g clip-path> wrapper, no frame
 * sequence — just a root <g> with <use> children pointing at <defs>. We
 * synthesize one animation with one frame whose clip rect matches the SVG
 * viewBox and whose uses come from the root <g>'s direct children.
 */
export function compileStatic(
  svgContent: string,
  opts: CompileStaticOptions
): CompileStaticResult {
  const animationName = opts.animationName ?? STATIC_ANIMATION_NAME;
  const baseParsed = parseSvg(svgContent);
  const staticFrame = buildStaticFrame(svgContent);

  const parsed: ParsedSvg = {
    ...baseParsed,
    frames: [staticFrame],
  };

  const atlas = buildStaticAtlas(staticFrame, animationName);
  const images = extractImages(parsed.patterns);

  const asset = deduplicate(
    opts.assetId,
    [{ name: animationName, svg: parsed, atlas }],
    images
  );

  if (opts.metadata) {
    applyColorZones(asset, opts.metadata, opts.tintMode ?? TintMode.Player);
  }

  if (opts.extras) asset.extras = opts.extras;

  const bytes = writeBinary(asset);

  return {
    bytes,
    stats: {
      uniquePaths: asset.paths.length,
      drawCommands: asset.drawCommands.length,
      bodyParts: asset.bodyParts.length,
      transforms: asset.transforms.length,
      frames: asset.frames.length,
      images: asset.images.length,
    },
  };
}

function buildStaticFrame(svgContent: string): ParsedFrame {
  const $ = load(svgContent, { xml: true });
  const $svg = $("svg");

  const viewBox = ($svg.attr("viewBox") ?? "0 0 0 0").trim().split(/\s+/).map(Number);
  const x = viewBox[0] ?? 0;
  const y = viewBox[1] ?? 0;
  const w = viewBox[2] ?? parseFloat($svg.attr("width") ?? "0");
  const h = viewBox[3] ?? parseFloat($svg.attr("height") ?? "0");

  const $rootGroup = $svg.children("g").not("[clip-path]").first();
  const offsetTransform = parseTransformAttr($rootGroup.attr("transform"));

  const uses: ParsedFrameUse[] = [];
  const accessorySlots: ParsedAccessorySlot[] = [];

  $rootGroup.children("use").each((_, el) => {
    const $el = $(el as Element);
    const href = ($el.attr("xlink:href") ?? $el.attr("href") ?? "").replace("#", "");
    const useTransform = composeUseTransform($el.attr("transform"), $el.attr("x"), $el.attr("y"));
    uses.push({ href, transform: useTransform });
  });

  return {
    clipPathId: "__static__",
    clipRect: { id: "__static__", x, y, width: w, height: h },
    offsetTransform,
    uses,
    accessorySlots,
  };
}

function buildStaticAtlas(
  frame: ParsedFrame,
  animationName: string = STATIC_ANIMATION_NAME
): AtlasJson {
  return {
    version: 1,
    animation: animationName,
    width: frame.clipRect.width,
    height: frame.clipRect.height,
    offsetX: frame.clipRect.x,
    offsetY: frame.clipRect.y,
    frames: [
      {
        id: "f0",
        x: frame.clipRect.x,
        y: frame.clipRect.y,
        width: frame.clipRect.width,
        height: frame.clipRect.height,
        offsetX: 0,
        offsetY: 0,
      },
    ],
    frameOrder: ["f0"],
    duplicates: {},
    fps: 1,
  };
}

function parseTransformAttr(attr: string | undefined): AffineTransform {
  if (!attr) return [...IDENTITY_TRANSFORM];
  const m = attr.match(/matrix\(([^)]+)\)/);
  if (m) {
    const parts = m[1]!.split(/[,\s]+/).map(Number);
    return [
      parts[0] ?? 1,
      parts[1] ?? 0,
      parts[2] ?? 0,
      parts[3] ?? 1,
      parts[4] ?? 0,
      parts[5] ?? 0,
    ];
  }
  const t = attr.match(/translate\(([^)]+)\)/);
  if (t) {
    const parts = t[1]!.split(/[,\s]+/).map(Number);
    return [1, 0, 0, 1, parts[0] ?? 0, parts[1] ?? 0];
  }
  return [...IDENTITY_TRANSFORM];
}

function composeUseTransform(
  transformAttr: string | undefined,
  xAttr: string | undefined,
  yAttr: string | undefined
): AffineTransform {
  const base = parseTransformAttr(transformAttr);
  const x = xAttr !== undefined ? parseFloat(xAttr) : 0;
  const y = yAttr !== undefined ? parseFloat(yAttr) : 0;
  if (x === 0 && y === 0) return base;
  return [base[0], base[1], base[2], base[3], base[4] + x, base[5] + y];
}
