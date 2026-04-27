import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { writeBinary } from "./binary-writer.ts";
import { applyColorZones } from "./color-mapper.ts";
import { deduplicate, type AnimationInput } from "./deduplicator.ts";
import { parseFrameSvg } from "./frame-svg.ts";
import { extractImages } from "./image-extractor.ts";
import { parseSvg } from "./svg-parser.ts";
import type {
  AffineTransform,
  AtlasFrame,
  AtlasJson,
  CompiledAsset,
  ExtrasPayload,
  ParsedGradient,
  ParsedNode,
  ParsedPattern,
  ParsedSvg,
  SpriteMetadata,
} from "./types.ts";
import { TintMode } from "./types.ts";

export interface CompileSpriteOptions {
  assetId: number;
  extras?: ExtrasPayload;
  /** Zone tint mode to stamp (defaults to Player — the 3-slot look). */
  tintMode?: TintMode;
}

export interface CompileSpriteResult {
  bytes: Uint8Array;
  animations: number;
  stats: {
    uniquePaths: number;
    drawCommands: number;
    bodyParts: number;
    transforms: number;
    frames: number;
    images: number;
    colorZones: number;
    totalSvgBytes: number;
  };
}

/**
 * Compile a sprite directory into a .dofasset binary.
 *
 * Supports two layouts:
 *
 *  1. Animation-per-subdir (characters, spells, emblems with multiple poses):
 *        <dir>/<animName>/atlas.svg + atlas.json
 *        <dir>/manifest.json (optional — lists animation names)
 *        <dir>/metadata.json (optional — color zones + accessory attachments)
 *
 *  2. Single-atlas (tiles, single-pose assets):
 *        <dir>/atlas.svg + manifest.json (+ atlas.json)
 *
 * This mirrors the shapes svg-spritesheet emits and what the old
 * dofus-vello-custom-format compiler accepted.
 */
export function compileSprite(
  spriteDir: string,
  opts: CompileSpriteOptions
): CompileSpriteResult {
  const rootManifestPath = join(spriteDir, "manifest.json");
  const rootAtlasSvgPath = join(spriteDir, "atlas.svg");
  const isSingleAtlas =
    existsSync(rootManifestPath) && existsSync(rootAtlasSvgPath);

  const allPatterns: ParsedPattern[] = [];
  const animationInputs: AnimationInput[] = [];
  let totalSvgBytes = 0;

  if (isSingleAtlas) {
    const manifest = JSON.parse(readFileSync(rootManifestPath, "utf-8"));
    const svgContent = readFileSync(rootAtlasSvgPath, "utf-8");
    totalSvgBytes += svgContent.length;
    const svg = parseSvg(svgContent);
    allPatterns.push(...svg.patterns);

    const atlasJsonPath = join(spriteDir, "atlas.json");
    const sidecar = existsSync(atlasJsonPath)
      ? (JSON.parse(readFileSync(atlasJsonPath, "utf-8")) as Partial<AtlasJson>)
      : null;

    for (const [animName, animDataRaw] of Object.entries(
      manifest.animations ?? {}
    )) {
      const animData = animDataRaw as Partial<AtlasJson>;
      const frames = sidecar?.frames ?? animData.frames ?? [];
      const frameOrder = sidecar?.frameOrder ?? animData.frameOrder ?? [];
      const atlas: AtlasJson = {
        version: manifest.version ?? sidecar?.version ?? 1,
        animation: animName,
        width: (sidecar?.width ?? animData.width) ?? 0,
        height: (sidecar?.height ?? animData.height) ?? 0,
        offsetX: sidecar?.offsetX ?? animData.offsetX ?? 0,
        offsetY: sidecar?.offsetY ?? animData.offsetY ?? 0,
        frames,
        frameOrder,
        duplicates: sidecar?.duplicates ?? animData.duplicates ?? {},
        fps: sidecar?.fps ?? animData.fps ?? 60,
        baseFrame: sidecar?.baseFrame ?? animData.baseFrame,
        baseZOrder: sidecar?.baseZOrder ?? animData.baseZOrder,
      };
      animationInputs.push({ name: animName, svg, atlas });
    }
  } else {
    const animNames = discoverAnimationDirs(spriteDir);
    for (const animName of animNames) {
      const animDir = join(spriteDir, animName);
      const svgPath = join(animDir, "atlas.svg");
      const jsonPath = join(animDir, "atlas.json");
      if (!existsSync(svgPath) || !existsSync(jsonPath)) continue;

      const svgContent = readFileSync(svgPath, "utf-8");
      const atlasContent = readFileSync(jsonPath, "utf-8");
      totalSvgBytes += svgContent.length;

      const svg = parseSvg(svgContent);
      const atlas = JSON.parse(atlasContent) as AtlasJson;
      allPatterns.push(...svg.patterns);
      animationInputs.push({ name: animName, svg, atlas });
    }
  }

  const images = extractImages(allPatterns);
  const asset = deduplicate(opts.assetId, animationInputs, images);

  const metadataPath = join(spriteDir, "metadata.json");
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(
      readFileSync(metadataPath, "utf-8")
    ) as SpriteMetadata;
    applyColorZones(asset, metadata, opts.tintMode ?? TintMode.Player);
  }

  if (opts.extras) asset.extras = opts.extras;

  const bytes = writeBinary(asset);

  return {
    bytes,
    animations: animationInputs.length,
    stats: {
      uniquePaths: asset.paths.length,
      drawCommands: asset.drawCommands.length,
      bodyParts: asset.bodyParts.length,
      transforms: asset.transforms.length,
      frames: asset.frames.length,
      images: asset.images.length,
      colorZones: asset.colorZones.length,
      totalSvgBytes,
    },
  };
}

function discoverAnimationDirs(spriteDir: string): string[] {
  return readdirSync(spriteDir)
    .filter((name) => {
      if (
        name === "_liaison_" ||
        name === "manifest.json" ||
        name === "metadata.json" ||
        name.startsWith(".")
      ) {
        return false;
      }
      try {
        return statSync(join(spriteDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

// ─── compileSpriteFromFrames ───────────────────────────────────────────────
//
// Consume the raw per-frame SVGs the PHP sprite extractor writes under
// `<svgDir>/<anim>_<n>.svg` — no atlas middleman required. Each frame's
// local id namespace is prefixed on the way in so the merged ParsedSvg
// has unique ids per (animation, frame); the existing `deduplicate()`
// then does the real work:
//
//   - path dedup (fnv1a hash of path segments)
//   - draw-command dedup (path_id + fill/stroke attrs)
//   - body-part dedup (ordered draw-command lists, cross-animation)
//   - transform dedup
//   - frame dedup (same body-part + transform list)
//   - image dedup (content hash of base64 PNG bytes — cross-animation too)
//
// All the element-level dedup `svg-spritesheet` used to do up-front happens
// here against the final binary representation, which is the only dedup
// that ends up in the `.dofasset` on disk.

export interface CompileSpriteFromFramesOptions {
  assetId: number;
  extras?: ExtrasPayload;
  tintMode?: TintMode;
  /** Optional metadata (color zones) already extracted from the source SWF. */
  metadata?: SpriteMetadata | null;
  /** fps to stamp on every animation — frame-based extracts don't carry fps. */
  fps?: number;
  /**
   * Optional per-animation frame filter — lets callers drop or reorder frames
   * before dedup. The canonical use case is the sprite-config `staticFrameLimit`
   * rule (static poses collapse identical frames to the first one).
   * Return the kept files in the desired playback order. An empty return drops
   * the whole animation.
   */
  filterFrames?: (animName: string, files: FrameSvgFile[]) => FrameSvgFile[];
  /**
   * Authoritative Flash character bounds to stamp into every frame's clipRect,
   * replacing the post-dedup zero-wipe below. Supplied by callers that have
   * access to the raw SWF bounds (twips/20) — tile/sprite compile stages
   * reading the PHP extractor's manifest.
   *
   * Vello reads `-clipRect[0..1]` in `compute_net_offset` and the scene
   * builder's `frame_clip_offset`, so stamping real Flash `(xmin, ymin)` here
   * makes Vello's anchor authoritative without any client-side re-derivation.
   *
   * Two forms:
   *   - Single `FlashBounds` object — every frame gets the same stamp (tiles,
   *     sprites where one character bounds covers every animation).
   *   - `Record<animName, FlashBounds>` — per-animation stamps (accessories,
   *     where each direction `R`/`L`/`F`/`B`/`S` carries its own bounds read
   *     from that direction's `atlas.json`).
   *
   * Omit to preserve the legacy wipe (`clipRect[0..1] = 0`) — used by every
   * spell caller today.
   */
  frameBounds?: FlashBounds | Record<string, FlashBounds>;
}

export interface FlashBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameSvgFile {
  frameIndex: number;
  path: string;
}

interface AnimationGroup {
  name: string;
  files: FrameSvgFile[];
}

export function compileSpriteFromFrames(
  spriteDir: string,
  opts: CompileSpriteFromFramesOptions
): CompileSpriteResult {
  let groups = discoverFrameGroups(spriteDir);
  if (opts.filterFrames) {
    const filter = opts.filterFrames;
    groups = groups
      .map((g) => ({ ...g, files: filter(g.name, g.files) }))
      .filter((g) => g.files.length > 0);
  }
  if (groups.length === 0) {
    throw new Error(
      `compileSpriteFromFrames: no per-frame SVGs under ${spriteDir}. ` +
        `Expected files like <anim>_<n>.svg.`
    );
  }

  const animationInputs: AnimationInput[] = [];
  const allPatterns: ParsedPattern[] = [];
  let totalSvgBytes = 0;

  for (let animIdx = 0; animIdx < groups.length; animIdx++) {
    const group = groups[animIdx]!;
    const definitions = new Map<string, ParsedNode>();
    const clipPaths: ParsedSvg["clipPaths"] = new Map();
    const patterns: ParsedPattern[] = [];
    const gradients: ParsedGradient[] = [];
    const frames: ParsedSvg["frames"] = [];

    let maxWidth = 0;
    let maxHeight = 0;

    // metadata.json holds the accessory-slot attachments (slot/depth/x/y/matrix)
    // per animation per frame. The PHP per-frame SVG extractor doesn't inject
    // `data-acc-slot` rects, so without this injection characters compile with
    // zero accessory slots and Vello silently drops every accessory.
    const animMetaFrames = opts.metadata?.animations?.[group.name] ?? [];

    for (let frameIdx = 0; frameIdx < group.files.length; frameIdx++) {
      const { path } = group.files[frameIdx]!;
      const content = readFileSync(path, "utf-8");
      totalSvgBytes += content.length;

      // Unique per-frame prefix prevents id collisions when different
      // frames reuse the same local id (`object-0`, etc.) for different
      // content. Short prefix keeps hash keys small. The frameIndex gets
      // stamped into the synthetic clipRect so the atlas↔SVG frame matcher
      // in deduplicate() keeps per-frame identity (otherwise every frame
      // shares (0,0,w,h) and collapses onto SVG frame 0).
      const prefix = `a${animIdx}f${frameIdx}_`;
      const parsed = parseFrameSvg(content, { prefix, frameIndex: frameIdx });

      const metaFrame = animMetaFrames[frameIdx];
      const metaAccs = metaFrame?.accessories ?? [];
      if (metaAccs.length > 0) {
        // Thread each accessory into the body-part stack at the correct
        // Flash display-list position: `insertAfterPart` counts how many
        // body parts draw BEFORE the accessory. Vello's scene builder
        // then emits the accessory immediately after that many parts, so
        // a cape (low depth) renders behind the torso and a hat (high
        // depth) renders on top. Falls back to "above everything" if the
        // metadata doesn't carry `parts` — safer than "below everything"
        // for the rare case where a new sprite ships without part depths.
        const partDepths = (metaFrame?.parts ?? []).map((p) => p.depth);
        const useCount = parsed.frame.uses.length;
        parsed.frame.accessorySlots = metaAccs.map((a) => {
          const before =
            partDepths.length > 0
              ? partDepths.filter((d) => d < a.depth).length
              : useCount;
          return {
            slotId: a.slot,
            tx: a.x,
            ty: a.y,
            matrix: a.matrix ? ([...a.matrix] as AffineTransform) : null,
            depth: a.depth,
            insertAfterPart: before,
            side: a.side ?? null,
          };
        });
      }

      for (const [id, def] of parsed.svg.definitions) definitions.set(id, def);
      for (const [id, rect] of parsed.svg.clipPaths) clipPaths.set(id, rect);
      patterns.push(...parsed.svg.patterns);
      gradients.push(...parsed.svg.gradients);
      frames.push(parsed.frame);

      if (parsed.width > maxWidth) maxWidth = parsed.width;
      if (parsed.height > maxHeight) maxHeight = parsed.height;
    }

    allPatterns.push(...patterns);

    const svg: ParsedSvg = {
      width: maxWidth,
      height: maxHeight,
      definitions,
      clipPaths,
      patterns,
      gradients,
      frames,
    };

    // Synthesize an AtlasJson that mirrors the per-frame geometry so
    // deduplicate() can index frames as usual.
    const atlas = synthesizeAtlas(group, maxWidth, maxHeight, opts.fps ?? 25);
    animationInputs.push({ name: group.name, svg, atlas });
  }

  const images = extractImages(allPatterns);
  const asset = deduplicate(opts.assetId, animationInputs, images);

  // The frameIndex encoded into atlas.x / parsed.clipRect.x was a matching
  // key for dedup only — frame-direct assets have no real atlas, so clear
  // those coordinates after dedup. The renderer uses `-clipRect[0..1]` as a
  // translation, so leaving frameIndex in place would shift every frame
  // horizontally by its index.
  //
  // When the caller supplies `frameBounds`, we replace the wipe with the
  // authoritative Flash character bounds (from the SWF, via the PHP
  // extractor's manifest). That makes clipRect the single source of truth
  // for Flash `(xmin, ymin, width, height)` — Vello's `compute_net_offset`
  // and scene-builder `clip_offset` already consume it.
  stampFrameBounds(asset, opts.frameBounds);

  if (opts.metadata) {
    applyColorZones(asset, opts.metadata, opts.tintMode ?? TintMode.Player);
  }
  if (opts.extras) asset.extras = opts.extras;

  const bytes = writeBinary(asset);

  return {
    bytes,
    animations: animationInputs.length,
    stats: {
      uniquePaths: asset.paths.length,
      drawCommands: asset.drawCommands.length,
      bodyParts: asset.bodyParts.length,
      transforms: asset.transforms.length,
      frames: asset.frames.length,
      images: asset.images.length,
      colorZones: asset.colorZones.length,
      totalSvgBytes,
    },
  };
}

/**
 * Group per-frame SVG files under `spriteDir` by animation name. A file
 * `walkR_12.svg` contributes to animation "walkR" at frame 12.
 */
function discoverFrameGroups(spriteDir: string): AnimationGroup[] {
  const byName = new Map<string, FrameSvgFile[]>();
  for (const entry of readdirSync(spriteDir)) {
    if (!entry.endsWith(".svg")) continue;
    if (entry.startsWith(".")) continue;
    const stem = entry.slice(0, -4);
    const match = stem.match(/^(.+)_(\d+)$/);
    if (!match) continue;
    const animName = match[1]!;
    const frameIndex = Number(match[2]);
    if (!Number.isFinite(frameIndex)) continue;
    let list = byName.get(animName);
    if (!list) {
      list = [];
      byName.set(animName, list);
    }
    list.push({ frameIndex, path: join(spriteDir, entry) });
  }

  const out: AnimationGroup[] = [];
  for (const [name, files] of byName) {
    files.sort((a, b) => a.frameIndex - b.frameIndex);
    out.push({ name, files });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Post-dedup cleanup of `clipRect[0..1]`. The frameIndex dedup marker that
 * `synthesizeAtlas` stamps into `clipRect[0]` is meaningful only for the
 * atlas-match step; it must be zeroed before serialization because the
 * renderer uses `-clipRect[0..1]` as a frame translation.
 *
 * NOTE: `frameBounds` is accepted on the option interface for forward
 * compatibility but is intentionally ignored here. The dedup pipeline at
 * `deduplicator.ts:626` already composes `frame.offsetTransform *
 * use.transform` into every `PartInstance.transform`, so the outer Flash
 * shift is baked into the part transforms. Stamping the same Flash origin
 * into `clipRect` would double-apply the shift at render time (via
 * `part_transform = clip_offset * part_inst.transform`) and misplace every
 * tile/sprite by exactly -xmin pixels.
 */
function stampFrameBounds(
  asset: CompiledAsset,
  _frameBounds: FlashBounds | Record<string, FlashBounds> | undefined
): void {
  for (const frame of asset.frames) {
    frame.clipRect[0] = 0;
    frame.clipRect[1] = 0;
  }
}

function synthesizeAtlas(
  group: AnimationGroup,
  width: number,
  height: number,
  fps: number
): AtlasJson {
  // x is used only as a matching key against the synthetic frame clipRect
  // (which stamps frameIndex into its x); not an atlas pixel coordinate.
  const frames: AtlasFrame[] = group.files.map((f) => ({
    id: `${group.name}_${f.frameIndex}`,
    x: f.frameIndex,
    y: 0,
    width,
    height,
    offsetX: 0,
    offsetY: 0,
  }));
  const frameOrder = frames.map((f) => f.id);
  return {
    version: 1,
    animation: group.name,
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    frames,
    frameOrder,
    duplicates: {},
    fps,
  };
}
