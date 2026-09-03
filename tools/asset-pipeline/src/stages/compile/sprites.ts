import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { SpriteMetadata } from "@dofus/dofasset-format";
import { compileSpriteFromFrames } from "@dofus/dofasset-format/pipeline";

import { logger } from "../../logger.ts";
import {
  distDofassetPath,
  extractCachePath,
  spriteConfigPath,
} from "../../paths.ts";
import {
  buildFrameFilter,
  loadSpriteConfig,
  type SpriteConfig,
} from "../../sprite-config.ts";
import { loadFlashBoundsManifest } from "../extract/manifest-bounds.ts";

export interface SpriteCompileEntry {
  gfxId: number;
  svgDir: string;
  dofassetPath: string;
  animations: number;
  sourceBytes: number;
  outputBytes: number;
  uniquePaths: number;
  drawCommands: number;
  bodyParts: number;
  transforms: number;
  frames: number;
  images: number;
  colorZones: number;
}

export interface SpriteCompileOptions {
  filterId?: number;
  categoryName?: string;
  /**
   * If true, delete the per-frame SVG dir after a successful compile so the
   * ~40 GB raw extract footprint doesn't linger. Default true.
   */
  cleanupRaw?: boolean;
  /**
   * fps to stamp on every animation. Defaults to the SWF's own frame rate,
   * which the PHP extractor records per sprite in its manifest.
   *
   * There is exactly one frame per `ShowFrame` here, so the rate has to be
   * the film's. The retired atlas stage resampled 20 fps to 60 by writing
   * each frame three times, and the 60 that used to be hardcoded here was
   * copied from *its* output — stamped on the un-resampled frame list it
   * played every animation three times too fast (QA-151).
   */
  fps?: number;
}

export interface SpriteCompileResult {
  outputDir: string;
  entries: SpriteCompileEntry[];
  skipped: number;
  failed: number;
  durationMs: number;
}

/**
 * Compile every sprite under `extract/<category>/svg/` straight from the
 * PHP extractor's per-frame SVGs — no atlas stage, no svg-spritesheet
 * subprocess. `compileSpriteFromFrames` does all the dedup the old atlas
 * pipeline did (and more — body-part + frame dedup across animations is
 * measurably tighter when the compiler sees every frame directly).
 *
 * Metadata (color zones) comes from `extract/<category>/meta/<id>/metadata.json`.
 * We delete each sprite's raw SVG dir after a successful compile by default
 * since the binary supersedes them and the raw set is enormous.
 */
export async function compileSprites(
  opts: SpriteCompileOptions = {}
): Promise<SpriteCompileResult> {
  const categoryName = opts.categoryName ?? "sprites";
  const cleanupRaw = opts.cleanupRaw ?? true;
  const extractRoot = extractCachePath(categoryName);
  const svgRoot = resolve(extractRoot, "svg");
  const metaRoot = resolve(extractRoot, "meta");
  const outputDir = distDofassetPath(categoryName.replace(/\./g, "/"));
  await mkdir(outputDir, { recursive: true });

  // Per-sprite rules live in assets/sprite-config.json. We load once up front;
  // buildFrameFilter rebuilds per sprite so per-id overrides apply.
  const spriteConfig: SpriteConfig = await loadSpriteConfig(spriteConfigPath());

  // Authoritative per-sprite Flash character bounds (bounds.xmin/20 et al),
  // written by `ExtractSpriteCommand::saveManifest`. Empty when the file is
  // missing (old extract run, filtered single-id run) — callers fall back to
  // the legacy zero-wipe of clipRect[0..1].
  const boundsManifest = await loadFlashBoundsManifest(
    resolve(svgRoot, "manifest.json"),
    "sprite"
  );

  const start = performance.now();
  const entries: SpriteCompileEntry[] = [];
  let skipped = 0;
  let failed = 0;

  let ids: string[];
  try {
    ids = await readdir(svgRoot);
  } catch {
    ids = [];
  }

  for (const name of ids) {
    const gfxId = Number(name);
    if (!Number.isFinite(gfxId)) continue;
    if (opts.filterId !== undefined && gfxId !== opts.filterId) {
      skipped++;
      continue;
    }

    const svgDir = resolve(svgRoot, name);
    const dofassetPath = resolve(outputDir, `${gfxId}.dofasset`);
    const metaPath = resolve(metaRoot, name, "metadata.json");

    let metadata: SpriteMetadata | null = null;
    try {
      metadata = JSON.parse(
        await readFile(metaPath, "utf-8")
      ) as SpriteMetadata;
    } catch {
      // no metadata.json — sprite compiles without color zones
    }

    const bounds = boundsManifest.get(gfxId);
    const fps = opts.fps ?? bounds?.fps;

    if (fps === undefined) {
      logger.warn(
        { gfxId, manifest: resolve(svgRoot, "manifest.json") },
        "compile:sprites — no frame rate in the extract manifest; " +
          "falling back to 60, which is right only for a resampled frame list"
      );
    }

    try {
      const result = compileSpriteFromFrames(svgDir, {
        assetId: gfxId,
        metadata,
        fps: fps ?? 60,
        filterFrames: buildFrameFilter(spriteConfig, gfxId),
        // Stamp Flash `(xmin, ymin, width, height)` into every frame's
        // clipRect so Vello's anchor math runs on authoritative bounds
        // instead of path-walked ones. One character bounds covers all
        // animations of a sprite — confirmed by the PHP manifest shape.
        frameBounds: bounds
          ? {
              x: bounds.offsetX,
              y: bounds.offsetY,
              width: bounds.width,
              height: bounds.height,
            }
          : undefined,
      });
      await mkdir(dirname(dofassetPath), { recursive: true });
      await writeFile(dofassetPath, result.bytes);

      entries.push({
        gfxId,
        svgDir,
        dofassetPath,
        animations: result.animations,
        sourceBytes: result.stats.totalSvgBytes,
        outputBytes: result.bytes.byteLength,
        uniquePaths: result.stats.uniquePaths,
        drawCommands: result.stats.drawCommands,
        bodyParts: result.stats.bodyParts,
        transforms: result.stats.transforms,
        frames: result.stats.frames,
        images: result.stats.images,
        colorZones: result.stats.colorZones,
      });

      if (cleanupRaw) {
        await rm(svgDir, { recursive: true, force: true });
      }
    } catch (err) {
      failed++;
      logger.warn(
        { gfxId, err: (err as Error).message },
        "compile:sprites failed"
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
