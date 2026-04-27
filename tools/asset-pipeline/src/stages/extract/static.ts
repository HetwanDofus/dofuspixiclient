import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { CategoryDef } from "../../category.ts";
import { logger } from "../../logger.ts";
import { extractCachePath, paths } from "../../paths.ts";
import { runPhp } from "./php-runner.ts";

export interface StaticMetadataFile {
  id: string;
  metadataPath: string;
}

export interface StaticExtractEntry {
  id: string;
  svgPath: string;
}

export interface StaticExtractOptions {
  filterId?: string;
  clean?: boolean;
}

export interface StaticExtractResult {
  outputDir: string;
  entries: StaticExtractEntry[];
  durationMs: number;
}

/**
 * Generic extractor for any flat static category: invokes extract-static
 * with --input=<sources>/<glob-dir> --output=<cache>/extract/<category.name>.
 * Derives the input directory by stripping the trailing "/*.swf" from the
 * category's source glob.
 */
export async function extractStatic(
  category: CategoryDef,
  opts: StaticExtractOptions = {}
): Promise<StaticExtractResult> {
  const inputDir = resolveInputDir(category);
  const outputDir = extractCachePath(category.name);
  await mkdir(outputDir, { recursive: true });

  const args: string[] = ["--input", inputDir, "--output", outputDir];
  if (opts.clean) args.push("--clean");
  if (opts.filterId !== undefined) args.push("--id", opts.filterId);

  logger.info(
    { category: category.name, inputDir, outputDir, filterId: opts.filterId },
    "extract:static starting"
  );

  const run = await runPhp({ binName: "extract-static", args });

  // Color-zoned categories (artworks, emblems, auras, alignments) get a
  // second pass that walks GAC.applyColor AS2 calls and emits per-id
  // metadata.json alongside the SVGs. Categories without the trait skip
  // this step cleanly.
  if (category.traits.colorZones) {
    const metaDir = resolve(extractCachePath(category.name), "_meta");
    await mkdir(metaDir, { recursive: true });
    const metaArgs: string[] = ["--input", inputDir, "--output", metaDir];
    if (opts.filterId !== undefined) metaArgs.push("--id", opts.filterId);
    try {
      await runPhp({ binName: "extract-static-metadata", args: metaArgs });
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, category: category.name },
        "extract-static-metadata failed (zones may be absent / non-AS2)"
      );
    }
  }

  const entries = await scanStatic(outputDir);

  logger.info(
    { count: entries.length, durationMs: run.durationMs },
    `extract:${category.name} done`
  );

  return { outputDir, entries, durationMs: run.durationMs };
}

function resolveInputDir(category: CategoryDef): string {
  const suffix = "/*.swf";
  if (!category.source.endsWith(suffix)) {
    throw new Error(
      `extractStatic requires a flat "<dir>/*.swf" source; got "${category.source}" for category ${category.name}`
    );
  }
  return resolve(paths.sources, category.source.slice(0, -suffix.length));
}

async function scanStatic(outputDir: string): Promise<StaticExtractEntry[]> {
  const glob = new Bun.Glob("*.svg");
  const entries: StaticExtractEntry[] = [];
  for await (const rel of glob.scan({ cwd: outputDir })) {
    entries.push({ id: basename(rel, ".svg"), svgPath: `${outputDir}/${rel}` });
  }
  entries.sort((a, b) => {
    const ai = Number(a.id);
    const bi = Number(b.id);
    if (!Number.isNaN(ai) && !Number.isNaN(bi)) return ai - bi;
    return a.id.localeCompare(b.id);
  });
  return entries;
}
