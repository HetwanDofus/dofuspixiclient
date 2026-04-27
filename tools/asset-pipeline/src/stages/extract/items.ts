import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { logger } from "../../logger.ts";
import { extractCachePath } from "../../paths.ts";
import { runPhp } from "./php-runner.ts";

export interface ItemExtractEntry {
  type: number;
  id: number;
  svgPath: string;
}

export interface ItemExtractOptions {
  filterType?: number;
  filterId?: number;
  /** If true, --clean is passed to the PHP bin (removes existing output). */
  clean?: boolean;
}

export interface ItemExtractResult {
  outputDir: string;
  entries: ItemExtractEntry[];
  durationMs: number;
}

export async function extractItems(
  opts: ItemExtractOptions = {}
): Promise<ItemExtractResult> {
  const outputDir = extractCachePath("items");
  await mkdir(outputDir, { recursive: true });

  const args: string[] = ["--output", outputDir];
  if (opts.clean) args.push("--clean");
  if (opts.filterType !== undefined) args.push("--type", String(opts.filterType));
  if (opts.filterId !== undefined) args.push("--id", String(opts.filterId));

  logger.info(
    { outputDir, filterType: opts.filterType, filterId: opts.filterId },
    "extract:items starting"
  );

  const run = await runPhp({ binName: "extract-items", args });

  const entries = await scanItems(outputDir);

  logger.info(
    { count: entries.length, durationMs: run.durationMs },
    "extract:items done"
  );

  return { outputDir, entries, durationMs: run.durationMs };
}

async function scanItems(outputDir: string): Promise<ItemExtractEntry[]> {
  const glob = new Bun.Glob("*/*.svg");
  const entries: ItemExtractEntry[] = [];

  for await (const rel of glob.scan({ cwd: outputDir })) {
    const type = Number(basename(dirname(rel)));
    const id = Number(basename(rel, ".svg"));
    if (!Number.isFinite(type) || !Number.isFinite(id)) continue;
    entries.push({ type, id, svgPath: `${outputDir}/${rel}` });
  }

  entries.sort((a, b) => (a.type - b.type) || (a.id - b.id));
  return entries;
}
