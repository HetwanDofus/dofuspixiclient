import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { logger } from "../../logger.ts";
import { extractCachePath } from "../../paths.ts";
import { runPhp } from "./php-runner.ts";

export interface AccessoryExtractEntry {
  /** Composite symbol name as exported from the bundle SWF (e.g. "16_10"). */
  symbol: string;
  /** Numeric accessory category (hat = 16, weapon = 6, cape = 17, pet = 4, shield = 81). */
  type: number;
  /** Per-category gfx id. */
  gfxId: number;
  svgDir: string;
}

export interface AccessoryExtractOptions {
  filterSymbol?: string;
  clean?: boolean;
}

export interface AccessoryExtractResult {
  outputDir: string;
  entries: AccessoryExtractEntry[];
  durationMs: number;
}

/**
 * Extract accessory sprites via the existing PHP `extract-accessories` bin.
 * Produces per-direction frame SVGs + atlas.json for every `{type}_{gfxId}`
 * symbol exported by the accessory bundle SWFs.
 */
export async function extractAccessories(
  opts: AccessoryExtractOptions = {}
): Promise<AccessoryExtractResult> {
  const outputDir = extractCachePath("sprites.accessories");
  await mkdir(outputDir, { recursive: true });

  const args: string[] = ["--output", outputDir];
  if (opts.clean) args.push("--clean");
  if (opts.filterSymbol) args.push("--symbol", opts.filterSymbol);

  logger.info({ outputDir, filterSymbol: opts.filterSymbol }, "extract:accessories starting");

  const start = performance.now();
  await runPhp({ binName: "extract-accessories", args });

  const entries = await scanAccessories(outputDir);
  logger.info(
    { count: entries.length, durationMs: Math.round(performance.now() - start) },
    "extract:accessories done"
  );

  return { outputDir, entries, durationMs: Math.round(performance.now() - start) };
}

async function scanAccessories(outputDir: string): Promise<AccessoryExtractEntry[]> {
  const entries: AccessoryExtractEntry[] = [];
  let names: string[];
  try {
    names = await readdir(outputDir);
  } catch {
    return entries;
  }

  for (const name of names) {
    const m = name.match(/^(\d+)_(\d+)$/);
    if (!m) continue;
    const type = Number(m[1]);
    const gfxId = Number(m[2]);
    entries.push({
      symbol: name,
      type,
      gfxId,
      svgDir: resolve(outputDir, name),
    });
  }

  entries.sort((a, b) => a.type - b.type || a.gfxId - b.gfxId);
  return entries;
}
