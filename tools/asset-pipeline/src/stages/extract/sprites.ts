import { mkdir, readdir, rm, symlink } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { CategoryDef } from "../../category.ts";
import { logger } from "../../logger.ts";
import { extractCachePath, paths, spritesSourceDir } from "../../paths.ts";
import { runPhp } from "./php-runner.ts";

export interface SpriteExtractEntry {
  gfxId: number;
  svgDir: string;
  metadataPath: string | null;
}

export interface SpriteExtractOptions {
  /** Only process this single sprite id (speeds up iterations — full set is ~1k SWFs). */
  filterId?: number;
  clean?: boolean;
  /**
   * Source subdir under clips/sprites (e.g. "" for main sprites, "chevauchor"
   * for mount riders). Defaults to the main character sprite dir.
   */
  subdir?: string;
  /** Category name used for the cache output path (defaults to "sprites"). */
  categoryName?: string;
}

export interface SpriteExtractResult {
  extractRoot: string;
  entries: SpriteExtractEntry[];
  durationMs: number;
}

/**
 * Extract one (or all) character sprite SWFs into per-frame SVGs and a
 * metadata.json containing color zones + accessory attachments.
 *
 * Layout produced:
 *   <cache>/extract/sprites/svg/<gfxId>/<anim>_<n>.svg
 *   <cache>/extract/sprites/meta/<gfxId>/metadata.json
 */
export async function extractSprites(
  opts: SpriteExtractOptions = {}
): Promise<SpriteExtractResult> {
  const categoryName = opts.categoryName ?? "sprites";
  const extractRoot = extractCachePath(categoryName);
  const svgOut = resolve(extractRoot, "svg");
  const metaOut = resolve(extractRoot, "meta");
  await mkdir(svgOut, { recursive: true });
  await mkdir(metaOut, { recursive: true });

  const start = performance.now();

  const sourceDir = opts.subdir
    ? resolve(spritesSourceDir(), opts.subdir)
    : spritesSourceDir();
  const spriteInputDir = await stageSpriteInputs(extractRoot, sourceDir, opts.filterId);

  logger.info(
    { filterId: opts.filterId, svgOut, metaOut },
    "extract:sprites starting"
  );

  await runPhp({
    binName: "extract-sprites",
    args: [
      "--input",
      spriteInputDir,
      "--output",
      extractRoot, // extract-sprites writes to <output>/svg/<id>/…
      ...(opts.clean ? ["--clean"] : []),
    ],
  });

  const metadataArgs = ["--output", metaOut];
  if (opts.filterId !== undefined) metadataArgs.push("--id", String(opts.filterId));
  await runPhp({
    binName: "extract-sprite-metadata",
    args: metadataArgs,
  });

  const entries = await scanSprites(svgOut, metaOut);

  logger.info(
    { count: entries.length, durationMs: Math.round(performance.now() - start) },
    "extract:sprites done"
  );

  return {
    extractRoot,
    entries,
    durationMs: Math.round(performance.now() - start),
  };
}

/**
 * Stage the SWFs to process into a temporary dir of symlinks so the PHP
 * extractor (which walks its --input dir) only sees the requested sprite(s).
 * Keeps the iteration loop fast when targeting a single gfxId.
 */
async function stageSpriteInputs(
  extractRoot: string,
  sourcesDir: string,
  filterId: number | undefined
): Promise<string> {
  if (filterId === undefined) return sourcesDir;

  const stageDir = resolve(extractRoot, "staging");
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  const swfName = `${filterId}.swf`;
  const src = resolve(sourcesDir, swfName);
  const dst = resolve(stageDir, swfName);
  await symlink(src, dst);
  return stageDir;
}

async function scanSprites(
  svgOut: string,
  metaOut: string
): Promise<SpriteExtractEntry[]> {
  const entries: SpriteExtractEntry[] = [];
  let idNames: string[];
  try {
    idNames = await readdir(svgOut);
  } catch {
    return entries;
  }

  for (const name of idNames) {
    const gfxId = Number(name);
    if (!Number.isFinite(gfxId)) continue;
    const svgDir = resolve(svgOut, name);
    const metaPath = resolve(metaOut, name, "metadata.json");
    const metadataPath = (await Bun.file(metaPath).exists()) ? metaPath : null;
    entries.push({ gfxId, svgDir, metadataPath });
  }

  entries.sort((a, b) => a.gfxId - b.gfxId);
  return entries;
}
