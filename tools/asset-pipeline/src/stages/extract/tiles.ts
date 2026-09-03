import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, resolve } from "node:path";

import { logger } from "../../logger.ts";
import { extractCachePath } from "../../paths.ts";
import { runPhp } from "./php-runner.ts";

export type TileKind = "ground" | "objects";

export interface TileExtractEntry {
  tileId: number;
  kind: TileKind;
  svgDir: string;
  frameCount: number;
}

export interface TileExtractOptions {
  kind: TileKind;
  clean?: boolean;
  /**
   * Extract only these tile ids. Everything already in the cache — SVG dirs
   * and manifest entries alike — is left alone, so a targeted re-extract
   * never costs the other ten thousand tiles their Flash bounds.
   */
  only?: number[];
}

export interface TileExtractResult {
  outputDir: string;
  entries: TileExtractEntry[];
  durationMs: number;
}

/**
 * Run `extract-tiles` to produce the per-frame SVG catalog under the asset
 * cache. The existing PHP bin walks every `g*.swf` / `o*.swf` file in the
 * gfx sources and writes one folder per tile id containing `tile_<n>.svg`
 * per frame.
 *
 * We stage a single PHP invocation against a temp output root then pull the
 * requested kind's subtree into the per-category cache so the dispatch
 * stays identical to the sprite flow (`cache/extract/<category>/svg/<id>/`).
 */
export async function extractTiles(
  opts: TileExtractOptions
): Promise<TileExtractResult> {
  const start = performance.now();
  const categoryName = `tiles.${opts.kind}`;
  const categoryRoot = extractCachePath(categoryName);
  const svgRoot = resolve(categoryRoot, "svg");
  await mkdir(svgRoot, { recursive: true });

  // extract-tiles writes both ground and objects into a single output tree
  // (`<output>/svg/{ground,objects}`). We ask it to write into a shared
  // staging dir then move the slice we care about into our per-category
  // cache so the frame-direct compile sees the same `<category>/svg/<id>/`
  // layout sprites use.
  const stagingRoot = resolve(categoryRoot, "_raw");
  if (opts.clean) await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  const args: string[] = ["--output", stagingRoot];
  if (opts.clean) args.push("--clean");
  if (opts.only?.length) args.push("--only", opts.only.join(","));

  logger.info(
    { kind: opts.kind, svgRoot, stagingRoot },
    "extract:tiles starting"
  );

  await runPhp({ binName: "extract-tiles", args });

  // Move the requested kind's tile dirs into the per-category cache.
  const srcKindDir = resolve(stagingRoot, "svg", opts.kind);
  const entries: TileExtractEntry[] = [];
  let ids: string[] = [];
  try {
    ids = await readdir(srcKindDir);
  } catch {
    // nothing extracted
  }

  for (const name of ids) {
    const tileId = Number(name);
    if (!Number.isFinite(tileId)) continue;
    const src = resolve(srcKindDir, name);
    const dst = resolve(svgRoot, name);
    try {
      await rm(dst, { recursive: true, force: true });
      await rename(src, dst);
    } catch (err) {
      logger.warn({ tileId, err: (err as Error).message }, "stage tile dir failed");
      continue;
    }
    let frameCount = 0;
    try {
      const frames = await readdir(dst);
      frameCount = frames.filter((f) => f.endsWith(".svg")).length;
    } catch {
      // empty
    }
    entries.push({
      tileId,
      kind: opts.kind,
      svgDir: dst,
      frameCount,
    });
  }

  // Preserve the PHP-written manifest (carries per-tile Flash bounds: offsetX,
  // offsetY, width, height, and the state ranges of interactive elements)
  // next to the SVG dirs so the compile stage can bake real offsets into Tile
  // Extras instead of defaulting to 0. A filtered run only re-extracted a few
  // tiles, so its manifest is merged into the one already there rather than
  // replacing it.
  const manifestPath = resolve(svgRoot, "manifest.json");
  try {
    if (opts.only?.length) {
      await mergeManifest(resolve(srcKindDir, "manifest.json"), manifestPath);
    } else {
      await rename(resolve(srcKindDir, "manifest.json"), manifestPath);
    }
  } catch (err) {
    logger.warn(
      { kind: opts.kind, err: (err as Error).message },
      "stage tile manifest failed"
    );
  }

  // Drop the staging root — the other kind's sub-tree was either already
  // moved (separate run) or not requested this time.
  await rm(stagingRoot, { recursive: true, force: true });

  entries.sort((a, b) => a.tileId - b.tileId);
  const durationMs = Math.round(performance.now() - start);

  logger.info(
    { kind: opts.kind, tiles: entries.length, durationMs },
    `extract:tiles.${opts.kind} done`
  );

  return { outputDir: svgRoot, entries, durationMs };
}

/**
 * Fold a partial extractor manifest into the cached one, entry by entry.
 * `metadata` is taken from the new run; every `tile-<id>` key it carries
 * replaces its counterpart and the rest survive untouched.
 */
async function mergeManifest(
  stagedPath: string,
  targetPath: string
): Promise<void> {
  const staged = JSON.parse(await readFile(stagedPath, "utf-8")) as Record<
    string,
    unknown
  >;
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(targetPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    // no cached manifest yet — the staged one stands on its own
  }

  const merged = { ...existing, ...staged };
  await writeFile(targetPath, JSON.stringify(merged, null, 2));
}

export interface TileClassificationEntry {
  behavior?: "static" | "slope" | "animated" | "random" | "resource";
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
}

/**
 * Read `assets/tile-classifications.json` + `assets/tile-overrides.json` and
 * return a per-(kind, tileId) classification lookup.
 */
export async function loadTileClassifications(
  classificationsPath: string,
  overridesPath: string | null
): Promise<Map<string, TileClassificationEntry>> {
  const out = new Map<string, TileClassificationEntry>();
  const read = async (p: string) => {
    try {
      const data = JSON.parse(await readFile(p, "utf-8")) as {
        ground?: Record<string, TileClassificationEntry>;
        objects?: Record<string, TileClassificationEntry>;
      };
      for (const kind of ["ground", "objects"] as const) {
        for (const [id, entry] of Object.entries(data[kind] ?? {})) {
          if (id.startsWith("_")) continue; // example/skip keys
          out.set(`${kind}:${id}`, entry);
        }
      }
    } catch {
      // missing file — silent
    }
  };
  await read(classificationsPath);
  if (overridesPath) await read(overridesPath);
  return out;
}

/**
 * Peek the first frame's width/height for a tile so the Tile extras section
 * can carry accurate canvas dimensions without re-parsing during compile.
 */
export async function readFirstFrameDims(
  svgDir: string
): Promise<{ width: number; height: number } | null> {
  try {
    const frames = await readdir(svgDir);
    const first = frames.find((f) => f.endsWith(".svg"));
    if (!first) return null;
    const content = await readFile(resolve(svgDir, first), "utf-8");
    const widthMatch = content.match(/\bwidth="([\d.]+)/);
    const heightMatch = content.match(/\bheight="([\d.]+)/);
    if (!widthMatch || !heightMatch) return null;
    return {
      width: parseFloat(widthMatch[1]!) || 0,
      height: parseFloat(heightMatch[1]!) || 0,
    };
  } catch {
    return null;
  }
}

// Silence unused-import lint: `basename`/`stat` may be used by future tile
// helpers in this module; keeping the imports avoids churn when wiring
// `loadTileClassifications` into the CLI.
void basename;
void stat;
