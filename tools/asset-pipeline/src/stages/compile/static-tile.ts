import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ExtrasKind, type ExtrasPayload } from "@dofus/dofasset-format";
import { compileStatic } from "@dofus/dofasset-format/pipeline";

import { loadCatalog } from "../../catalog.ts";
import type { CategoryDef } from "../../category.ts";
import { logger } from "../../logger.ts";
import { distDofassetPath } from "../../paths.ts";

export interface StaticTileCompileEntry {
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

export interface StaticTileCompileOptions {
  filterId?: string;
}

export interface StaticTileCompileResult {
  outputDir: string;
  entries: StaticTileCompileEntry[];
  skipped: number;
  failed: number;
  durationMs: number;
}

function categoryFsPath(name: string): string {
  return name.replace(/\./g, "/");
}

function idToAssetId(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n & 0xffffffff : 0;
}

/**
 * Parse the SVG's viewBox so we can stamp width/height/offset into the
 * synthesised TileExtras payload without re-walking the SVG in Vello.
 */
function readViewBox(svg: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const match = svg.match(/viewBox="([^"]+)"/);
  if (match) {
    const parts = match[1]!.trim().split(/\s+/).map(Number);
    return {
      x: parts[0] ?? 0,
      y: parts[1] ?? 0,
      width: parts[2] ?? 0,
      height: parts[3] ?? 0,
    };
  }
  const wMatch = svg.match(/<svg[^>]*\swidth="([^"]+)"/);
  const hMatch = svg.match(/<svg[^>]*\sheight="([^"]+)"/);
  return {
    x: 0,
    y: 0,
    width: parseFloat(wMatch?.[1] ?? "0"),
    height: parseFloat(hMatch?.[1] ?? "0"),
  };
}

/**
 * Build a TileExtras payload for a single-frame static asset. The client's
 * tile-vello-renderer hardcodes animation name "tile", so we emit one
 * animation named "tile" with one frame named "f0".
 */
function buildTileExtras(
  id: string,
  viewBox: { x: number; y: number; width: number; height: number }
): ExtrasPayload {
  return {
    kind: ExtrasKind.Tile,
    data: {
      version: 1,
      spriteId: id,
      behavior: "static" as const,
      animations: {
        tile: {
          animation: "tile",
          width: viewBox.width,
          height: viewBox.height,
          offsetX: viewBox.x,
          offsetY: viewBox.y,
          fps: 1,
          frames: [
            {
              id: "f0",
              x: viewBox.x,
              y: viewBox.y,
              width: viewBox.width,
              height: viewBox.height,
              offsetX: 0,
              offsetY: 0,
            },
          ],
          frameOrder: ["f0"],
          duplicates: {},
        },
      },
    },
  };
}

/**
 * Compile a category of single-frame SVGs (gfx.tactic, gfx.cell) into tile-
 * shaped dofassets. Reuses the static compiler's SVG→binary path but renames
 * the synthesised animation to "tile" and attaches a TileExtras payload so
 * the client's atlas loader + tile-vello-renderer can consume these assets
 * through the standard tile pipeline.
 */
export async function compileStaticTileCategory(
  category: CategoryDef,
  opts: StaticTileCompileOptions = {}
): Promise<StaticTileCompileResult> {
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
  const entries: StaticTileCompileEntry[] = [];
  let failed = 0;
  let skipped = 0;

  for (const extracted of section.entries) {
    if (opts.filterId !== undefined && extracted.id !== opts.filterId) {
      skipped++;
      continue;
    }
    try {
      const svg = await readFile(extracted.svgPath, "utf-8");
      const viewBox = readViewBox(svg);
      const result = compileStatic(svg, {
        assetId: idToAssetId(extracted.id),
        animationName: "tile",
        extras: buildTileExtras(extracted.id, viewBox),
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
