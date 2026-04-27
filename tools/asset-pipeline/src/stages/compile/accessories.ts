import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  compileSpriteFromFrames,
  type FlashBounds,
} from "@dofus/dofasset-format/pipeline";

import { logger } from "../../logger.ts";
import { distDofassetPath, extractCachePath } from "../../paths.ts";

export interface AccessoryCompileEntry {
  symbol: string;
  type: number;
  gfxId: number;
  dofassetPath: string;
  outputBytes: number;
  sourceBytes: number;
  uniquePaths: number;
  drawCommands: number;
  bodyParts: number;
  transforms: number;
  frames: number;
  images: number;
}

export interface AccessoryCompileOptions {
  filterSymbol?: string;
  /** Delete the per-symbol raw extract dir after successful compile (default true). */
  cleanupRaw?: boolean;
}

export interface AccessoryCompileResult {
  outputDir: string;
  entries: AccessoryCompileEntry[];
  skipped: number;
  failed: number;
  durationMs: number;
}

/**
 * Compile accessory bundles straight from per-direction frame SVGs — no
 * svg-spritesheet subprocess. Each accessory symbol has a nested layout:
 *
 *   <extract>/<type>_<gfx>/<direction>/frame_<n>.svg
 *
 * We flatten that into an in-place `<direction>_<n>.svg` naming so
 * `compileSpriteFromFrames` sees one animation per direction
 * (`R`, `L`, `F`, `B`, `S`, plus the `RR`/`RL`/`W…` variants capes use).
 */
export async function compileAccessories(
  opts: AccessoryCompileOptions = {}
): Promise<AccessoryCompileResult> {
  const extractRoot = extractCachePath("sprites.accessories");
  const outputDir = distDofassetPath("sprites/accessories");
  const cleanupRaw = opts.cleanupRaw ?? true;
  await mkdir(outputDir, { recursive: true });

  const start = performance.now();
  const entries: AccessoryCompileEntry[] = [];
  let skipped = 0;
  let failed = 0;

  let symbols: string[];
  try {
    symbols = await readdir(extractRoot);
  } catch {
    symbols = [];
  }

  for (const symbol of symbols) {
    if (opts.filterSymbol && symbol !== opts.filterSymbol) {
      skipped++;
      continue;
    }
    const m = symbol.match(/^(\d+)_(\d+)$/);
    if (!m) {
      skipped++;
      continue;
    }
    const type = Number(m[1]);
    const gfxId = Number(m[2]);
    const symbolDir = resolve(extractRoot, symbol);

    try {
      const flatDir = await flattenDirections(symbolDir);
      if (!flatDir) {
        skipped++;
        continue;
      }

      // Read each direction's atlas.json for its authoritative Flash bounds.
      // compileSpriteFromFrames groups `<direction>_<n>.svg` into an animation
      // named after the direction, so a per-direction Record feeds each
      // animation's frames the right clipRect stamp.
      const frameBounds = await loadAccessoryDirectionBounds(symbolDir);

      const result = compileSpriteFromFrames(flatDir, {
        assetId: (type << 16) | gfxId,
        fps: 60,
        frameBounds: Object.keys(frameBounds).length > 0 ? frameBounds : undefined,
      });

      const dofassetPath = resolve(outputDir, `${symbol}.dofasset`);
      await mkdir(dirname(dofassetPath), { recursive: true });
      await writeFile(dofassetPath, result.bytes);

      entries.push({
        symbol,
        type,
        gfxId,
        dofassetPath,
        outputBytes: result.bytes.byteLength,
        sourceBytes: result.stats.totalSvgBytes,
        uniquePaths: result.stats.uniquePaths,
        drawCommands: result.stats.drawCommands,
        bodyParts: result.stats.bodyParts,
        transforms: result.stats.transforms,
        frames: result.stats.frames,
        images: result.stats.images,
      });

      await rm(flatDir, { recursive: true, force: true });
      if (cleanupRaw) {
        await rm(symbolDir, { recursive: true, force: true });
      }
    } catch (err) {
      failed++;
      logger.warn(
        { symbol, err: (err as Error).message },
        "compile:accessories failed"
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

interface AccessoryAtlas {
  width?: number;
  height?: number;
  frames?: Array<{
    offsetX?: number;
    offsetY?: number;
    width?: number;
    height?: number;
  }>;
}

/**
 * Load Flash bounds per direction for an accessory symbol by reading each
 * direction's `atlas.json`. All frames of a direction share the same
 * character bounds, so we take the first frame's offsets + the atlas-level
 * width/height as the direction's stamp.
 *
 * Returns an empty record when no atlas.json is present — caller treats this
 * as "no bounds available, fall back to zero-wipe".
 */
async function loadAccessoryDirectionBounds(
  symbolDir: string
): Promise<Record<string, FlashBounds>> {
  const out: Record<string, FlashBounds> = {};
  let directions: string[];
  try {
    directions = await readdir(symbolDir);
  } catch {
    return out;
  }
  for (const direction of directions) {
    const atlasPath = resolve(symbolDir, direction, "atlas.json");
    let raw: string;
    try {
      raw = await readFile(atlasPath, "utf-8");
    } catch {
      continue;
    }
    let atlas: AccessoryAtlas;
    try {
      atlas = JSON.parse(raw) as AccessoryAtlas;
    } catch {
      continue;
    }
    const first = atlas.frames?.[0];
    if (!first) continue;
    out[direction] = {
      x: Number(first.offsetX) || 0,
      y: Number(first.offsetY) || 0,
      width: Number(atlas.width ?? first.width) || 0,
      height: Number(atlas.height ?? first.height) || 0,
    };
  }
  return out;
}

/**
 * Copy each `<direction>/frame_<n>.svg` under `symbolDir` into a sibling
 * `<symbolDir>.flat/<direction>_<n>.svg`, flattening the directory tree so
 * `compileSpriteFromFrames` sees one animation per direction.
 *
 * Returns the flat dir path, or `null` if the symbol had no frames.
 */
async function flattenDirections(symbolDir: string): Promise<string | null> {
  const flat = `${symbolDir}.flat`;
  await rm(flat, { recursive: true, force: true });
  await mkdir(flat, { recursive: true });

  let directions: string[];
  try {
    directions = await readdir(symbolDir);
  } catch {
    return null;
  }

  let hasFrames = false;
  for (const direction of directions) {
    const dirPath = resolve(symbolDir, direction);
    let stats;
    try {
      stats = await stat(dirPath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;

    let frames: string[];
    try {
      frames = await readdir(dirPath);
    } catch {
      continue;
    }

    for (const frame of frames) {
      const m = frame.match(/^frame_(\d+)\.svg$/);
      if (!m) continue;
      const dest = resolve(flat, `${direction}_${m[1]}.svg`);
      await copyFile(resolve(dirPath, frame), dest);
      hasFrames = true;
    }
  }

  return hasFrames ? flat : null;
}
