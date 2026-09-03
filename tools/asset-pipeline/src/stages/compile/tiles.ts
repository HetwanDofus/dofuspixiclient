import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ExtrasKind, type ExtrasPayload } from "@dofus/dofasset-format";
import { compileSpriteFromFrames } from "@dofus/dofasset-format/pipeline";

import { logger } from "../../logger.ts";
import {
  distDofassetPath,
  extractCachePath,
  tileClassificationsPath,
  tileOverridesPath,
} from "../../paths.ts";
import { loadFlashBoundsManifest } from "../extract/manifest-bounds.ts";
import {
  loadTileClassifications,
  readFirstFrameDims,
  type TileClassificationEntry,
} from "../extract/tiles.ts";

export type TileKind = "ground" | "objects";

export interface TileCompileEntry {
  tileId: number;
  kind: TileKind;
  svgDir: string;
  dofassetPath: string;
  sourceBytes: number;
  outputBytes: number;
  behavior: "static" | "slope" | "animated" | "random" | "resource";
  uniquePaths: number;
  drawCommands: number;
  bodyParts: number;
  transforms: number;
  frames: number;
  images: number;
}

export interface TileCompileOptions {
  kind: TileKind;
  filterId?: number;
  /** Compile only these tile ids — the set form of `filterId`. */
  filterIds?: number[];
  /** Delete the tile's raw per-frame dir after compile (default true). */
  cleanupRaw?: boolean;
}

export interface TileCompileResult {
  outputDir: string;
  entries: TileCompileEntry[];
  skipped: number;
  failed: number;
  durationMs: number;
}

/**
 * Compile a tile family straight from the per-frame SVGs produced by
 * `extractTiles()` — no atlas stage, no svg-spritesheet. The tile's
 * behavior classification (from `assets/tile-classifications.json` +
 * `assets/tile-overrides.json`) gets baked into the `.dofasset` Extras
 * section so the client can consume everything from one binary.
 *
 * Expected on-disk layout:
 *   <cache>/extract/tiles.<kind>/svg/<tileId>/tile_<n>.svg
 *
 * `compileSpriteFromFrames` treats `tile_<n>.svg` files as frames of a
 * single animation named "tile" — matching the single-animation convention
 * every tile uses in the Dofus renderer.
 */
export async function compileTiles(
  opts: TileCompileOptions
): Promise<TileCompileResult> {
  const categoryName = `tiles.${opts.kind}`;
  const svgRoot = resolve(extractCachePath(categoryName), "svg");
  const outputDir = distDofassetPath(`tiles/${opts.kind}`);
  const cleanupRaw = opts.cleanupRaw ?? true;
  await mkdir(outputDir, { recursive: true });

  const classifications = await loadTileClassifications(
    tileClassificationsPath(),
    tileOverridesPath()
  );

  // Per-tile Flash bounds (offsetX/Y, width, height) written by the PHP
  // extractor. Empty map when missing — each tile falls back to the SVG-peek
  // path below with zero offsets, matching the legacy behavior.
  const extractManifest = await loadFlashBoundsManifest(
    resolve(svgRoot, "manifest.json"),
    "tile"
  );

  const start = performance.now();
  const entries: TileCompileEntry[] = [];
  let skipped = 0;
  let failed = 0;

  let ids: string[];
  try {
    ids = await readdir(svgRoot);
  } catch {
    ids = [];
  }

  for (const name of ids) {
    const tileId = Number(name);
    if (!Number.isFinite(tileId)) continue;
    if (opts.filterId !== undefined && tileId !== opts.filterId) {
      skipped++;
      continue;
    }
    if (opts.filterIds?.length && !opts.filterIds.includes(tileId)) {
      skipped++;
      continue;
    }

    const svgDir = resolve(svgRoot, name);
    const classification = classifications.get(`${opts.kind}:${name}`) ?? {};
    const extractEntry = extractManifest.get(tileId);
    // Prefer the PHP manifest's dims — it already holds Flash's bounds
    // (bounds.width/20, bounds.height/20) and dodges any rounding drift the
    // SVG's own `width=`/`height=` attributes pick up when re-serialized.
    const dims = extractEntry
      ? { width: extractEntry.width, height: extractEntry.height }
      : ((await readFirstFrameDims(svgDir)) ?? { width: 0, height: 0 });

    const dofassetPath = resolve(outputDir, `${tileId}.dofasset`);

    try {
      // The frame-direct compile will read tile_<n>.svg files as frames of
      // one animation named "tile". We build the tile extras ahead of time
      // using the classification + the first frame's dimensions.
      let frameCount = 0;
      try {
        const frames = await readdir(svgDir);
        frameCount = frames.filter((f) => f.endsWith(".svg")).length;
      } catch {
        /* empty */
      }

      // States win over the classification file: a tile the extractor read
      // as an interactive state machine *is* one, whatever a hand-written
      // entry from before that pass says (half the gathering resources were
      // filed as `animated`, which sent the client down the wrong path).
      const states = extractEntry?.states;
      const behavior = states
        ? ("resource" as const)
        : (classification.behavior ?? inferBehavior(opts.kind, frameCount));
      const extras = buildTileExtras({
        tileId,
        behavior,
        classification,
        width: dims.width,
        height: dims.height,
        frameCount,
        states,
      });

      const result = compileSpriteFromFrames(svgDir, {
        assetId: tileId,
        fps: classification.fps ?? 60,
        extras,
        // Stamp Flash `(xmin, ymin, width, height)` into every frame's
        // clipRect so Vello's `compute_net_offset` and `frame_clip_offset`
        // produce an authoritative anchor — no client-side compensation.
        frameBounds: extractEntry
          ? {
              x: extractEntry.offsetX,
              y: extractEntry.offsetY,
              width: extractEntry.width,
              height: extractEntry.height,
            }
          : undefined,
      });
      await mkdir(dirname(dofassetPath), { recursive: true });
      await writeFile(dofassetPath, result.bytes);

      entries.push({
        tileId,
        kind: opts.kind,
        svgDir,
        dofassetPath,
        sourceBytes: result.stats.totalSvgBytes,
        outputBytes: result.bytes.byteLength,
        behavior,
        uniquePaths: result.stats.uniquePaths,
        drawCommands: result.stats.drawCommands,
        bodyParts: result.stats.bodyParts,
        transforms: result.stats.transforms,
        frames: result.stats.frames,
        images: result.stats.images,
      });

      if (cleanupRaw) {
        await rm(svgDir, { recursive: true, force: true });
      }
    } catch (err) {
      failed++;
      logger.warn(
        { tileId, kind: opts.kind, err: (err as Error).message },
        "compile:tiles failed"
      );
    }
  }

  return {
    outputDir,
    entries,
    skipped,
    failed,
    durationMs: Math.round(performance.now() - start),
  };
}

/**
 * Reproduce the fallback classification heuristic `tile-manifest-converter`
 * uses on the client side so both sides agree when the classifications
 * file hasn't tagged a tile:
 *
 *   - 1 frame                   → static
 *   - ground + multi-frame      → slope
 *   - objects + multi-frame     → random  (safe default; avoids flicker)
 */
function inferBehavior(
  kind: TileKind,
  frameCount: number
): "static" | "slope" | "random" {
  if (frameCount <= 1) return "static";
  return kind === "ground" ? "slope" : "random";
}

function buildTileExtras(args: {
  tileId: number;
  behavior: "static" | "slope" | "animated" | "random" | "resource";
  classification: TileClassificationEntry;
  width: number;
  height: number;
  frameCount: number;
  states?: Array<{ frame: number; start: number; count: number }>;
}): ExtrasPayload {
  // Per-frame entries for the client's SpritesheetManifest reconstruction.
  // Each frame uses the first-frame dimensions — tiles ship uniform frame
  // sizes so this holds for every behavior including `random` / `slope`.
  // Flash `(xmin, ymin)` does NOT ride here — it lives on Frame.clipRect in
  // the binary, where Vello's `compute_net_offset` and `frame_clip_offset`
  // already consume it. Duplicating the same offset in Extras would give
  // downstream consumers two sources to diverge.
  const frames = Array.from({ length: args.frameCount }, (_, i) => ({
    id: `tile_${i}`,
    x: 0,
    y: 0,
    width: args.width,
    height: args.height,
    offsetX: 0,
    offsetY: 0,
  }));
  return {
    kind: ExtrasKind.Tile,
    data: {
      version: 1,
      spriteId: String(args.tileId),
      behavior: args.behavior,
      ...(args.states ? { states: args.states } : {}),
      fpsHint: args.classification.fps,
      autoplay: args.classification.autoplay,
      loop: args.classification.loop,
      animations: {
        tile: {
          width: args.width,
          height: args.height,
          offsetX: 0,
          offsetY: 0,
          fps: args.classification.fps ?? 60,
          frames,
          frameOrder: frames.map((f) => f.id),
          duplicates: {},
        },
      },
    },
  };
}
