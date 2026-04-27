import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { compileStatic } from "@dofus/dofasset-format/pipeline";

import { loadCatalog } from "../../catalog.ts";
import { logger } from "../../logger.ts";
import { distDofassetPath } from "../../paths.ts";

export interface ItemCompileEntry {
  type: number;
  id: number;
  svgPath: string;
  dofassetPath: string;
  sourceBytes: number;
  outputBytes: number;
  uniquePaths: number;
  drawCommands: number;
}

export interface ItemCompileOptions {
  filterType?: number;
  filterId?: number;
}

export interface ItemCompileResult {
  outputDir: string;
  entries: ItemCompileEntry[];
  skipped: number;
  failed: number;
  durationMs: number;
}

/**
 * Per-category id packing: items use (type, id) composite. The catalog writer
 * carries it as the first 16 bits = type, last 16 bits = id.
 */
function packItemAssetId(type: number, id: number): number {
  return ((type & 0xffff) << 16) | (id & 0xffff);
}

export async function compileItems(
  opts: ItemCompileOptions = {}
): Promise<ItemCompileResult> {
  const outputDir = distDofassetPath("items");
  await mkdir(outputDir, { recursive: true });

  const catalog = await loadCatalog();
  const section = catalog.byCategory["items"];
  if (!section || section.kind !== "items") {
    throw new Error(
      "No items extract section found in catalog — run `pipeline run items` first"
    );
  }

  const start = performance.now();
  const entries: ItemCompileEntry[] = [];
  let failed = 0;
  let skipped = 0;

  for (const extracted of section.entries) {
    if (opts.filterType !== undefined && extracted.type !== opts.filterType) {
      skipped++;
      continue;
    }
    if (opts.filterId !== undefined && extracted.id !== opts.filterId) {
      skipped++;
      continue;
    }

    try {
      const svg = await readFile(extracted.svgPath, "utf-8");
      const result = compileStatic(svg, {
        assetId: packItemAssetId(extracted.type, extracted.id),
      });

      const dofassetPath = `${outputDir}/${extracted.type}/${extracted.id}.dofasset`;
      await mkdir(dirname(dofassetPath), { recursive: true });
      await writeFile(dofassetPath, result.bytes);

      entries.push({
        type: extracted.type,
        id: extracted.id,
        svgPath: extracted.svgPath,
        dofassetPath,
        sourceBytes: svg.length,
        outputBytes: result.bytes.byteLength,
        uniquePaths: result.stats.uniquePaths,
        drawCommands: result.stats.drawCommands,
      });
    } catch (err) {
      failed++;
      logger.warn(
        { type: extracted.type, id: extracted.id, err: (err as Error).message },
        "compile:items failed"
      );
    }
  }

  const durationMs = Math.round(performance.now() - start);
  return { outputDir, entries, skipped, failed, durationMs };
}
