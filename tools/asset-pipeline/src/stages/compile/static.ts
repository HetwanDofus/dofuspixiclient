import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { TintMode, type SpriteMetadata } from "@dofus/dofasset-format";
import { compileStatic } from "@dofus/dofasset-format/pipeline";
import { match } from "ts-pattern";

import { loadCatalog } from "../../catalog.ts";
import type { CategoryDef, TintMode as TintModeTag } from "../../category.ts";
import { logger } from "../../logger.ts";
import { distDofassetPath, extractCachePath } from "../../paths.ts";

function tintModeFor(tag: TintModeTag | undefined): TintMode {
  return match(tag)
    .with("guild", () => TintMode.Guild)
    .with("alignmentLevel", () => TintMode.AlignmentLevel)
    .with("spell", () => TintMode.Spell)
    .otherwise(() => TintMode.Player);
}

async function loadMetadata(
  category: CategoryDef,
  id: string
): Promise<SpriteMetadata | null> {
  if (!category.traits.colorZones) return null;
  const metaPath = resolve(extractCachePath(category.name), "_meta", id, "metadata.json");
  try {
    return JSON.parse(await readFile(metaPath, "utf-8")) as SpriteMetadata;
  } catch {
    return null;
  }
}

export interface StaticCompileEntry {
  id: string;
  svgPath: string;
  dofassetPath: string;
  sourceBytes: number;
  outputBytes: number;
  uniquePaths: number;
  drawCommands: number;
  bodyParts: number;
  transforms: number;
  frames: number;
  images: number;
}

export interface StaticCompileOptions {
  filterId?: string;
}

export interface StaticCompileResult {
  outputDir: string;
  entries: StaticCompileEntry[];
  skipped: number;
  failed: number;
  durationMs: number;
}

/**
 * Translate a dotted category name (e.g. "artworks.breeds") into a
 * filesystem-friendly path ("artworks/breeds") so .dofassets mirror the
 * source tree under assets/dist/dofassets.
 */
function categoryFsPath(name: string): string {
  return name.replace(/\./g, "/");
}

/** Parse numeric id (falls back to 0 for non-numeric), used as asset id. */
function idToAssetId(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n & 0xffffffff : 0;
}

export async function compileStaticCategory(
  category: CategoryDef,
  opts: StaticCompileOptions = {}
): Promise<StaticCompileResult> {
  const outputDir = distDofassetPath(categoryFsPath(category.name));
  await mkdir(outputDir, { recursive: true });

  const catalog = await loadCatalog();
  const section = catalog.byCategory[category.name];
  if (!section || section.kind !== "static") {
    throw new Error(
      `No static extract section for ${category.name} — run \`pipeline run ${category.name}\` first`
    );
  }

  const start = performance.now();
  const entries: StaticCompileEntry[] = [];
  let failed = 0;
  let skipped = 0;

  for (const extracted of section.entries) {
    if (opts.filterId !== undefined && extracted.id !== opts.filterId) {
      skipped++;
      continue;
    }
    try {
      const svg = await readFile(extracted.svgPath, "utf-8");
      const metadata = await loadMetadata(category, extracted.id);
      const result = compileStatic(svg, {
        assetId: idToAssetId(extracted.id),
        metadata,
        tintMode: tintModeFor(category.traits.colorZones?.tintMode),
      });

      const dofassetPath = `${outputDir}/${extracted.id}.dofasset`;
      await mkdir(dirname(dofassetPath), { recursive: true });
      await writeFile(dofassetPath, result.bytes);

      entries.push({
        id: extracted.id,
        svgPath: extracted.svgPath,
        dofassetPath,
        sourceBytes: svg.length,
        outputBytes: result.bytes.byteLength,
        uniquePaths: result.stats.uniquePaths,
        drawCommands: result.stats.drawCommands,
        bodyParts: result.stats.bodyParts,
        transforms: result.stats.transforms,
        frames: result.stats.frames,
        images: result.stats.images,
      });
    } catch (err) {
      failed++;
      logger.warn(
        { id: extracted.id, err: (err as Error).message },
        `compile:${category.name} failed`
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
