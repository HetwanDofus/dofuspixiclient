import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { CategoryDef } from "../../category.ts";
import { logger } from "../../logger.ts";
import { extractCachePath, paths } from "../../paths.ts";
import { runPhp } from "./php-runner.ts";

export interface BundleExtractEntry {
  id: string;
  svgPath: string;
}

export interface BundleExtractOptions {
  filterSymbol?: string;
  clean?: boolean;
}

export interface BundleExtractResult {
  outputDir: string;
  entries: BundleExtractEntry[];
  durationMs: number;
}

/**
 * Dump every exported symbol of a single-file bundle SWF into its own SVG
 * under the category's extract cache. The PHP bin walks
 * `SwfExtractor::exported()` and writes `<outputDir>/<sanitized-name>.svg`,
 * letting the existing static-compile dispatch take over from here.
 *
 * Categories this handles are those whose `source` is a concrete `.swf`
 * file (no glob) — the ~17 bundle files at the root of `clips/`.
 */
export async function extractBundleSymbols(
  category: CategoryDef,
  opts: BundleExtractOptions = {}
): Promise<BundleExtractResult> {
  if (!category.source.endsWith(".swf") || category.source.includes("*")) {
    throw new Error(
      `extractBundleSymbols expects a single-SWF source; got "${category.source}" for ${category.name}`
    );
  }
  const inputFile = resolve(paths.sources, category.source);
  const outputDir = extractCachePath(category.name);
  await mkdir(outputDir, { recursive: true });

  const args: string[] = ["--input", inputFile, "--output", outputDir];
  if (opts.clean) args.push("--clean");
  if (opts.filterSymbol) args.push("--symbol", opts.filterSymbol);
  // staticTile categories (gfx.tactic, gfx.cell) expect per-frame output for
  // multi-frame symbols — the tactic theme sprites (arene, foret, …) carry
  // three decor frames that the client cycles through.
  // ui.loader (cc-loader) animates each UI component's slide-in / hold /
  // slide-out across many frames — UI_StringCourse hides the parchment in
  // frame 0 (`stop()`) and only reveals it from frame 2 onward; we need
  // every frame so the client can pick the steady-state one.
  if (category.shape === "staticTile" || category.name === "ui.loader") {
    args.push("--expand-frames");
  }

  logger.info(
    { category: category.name, inputFile, outputDir },
    "extract:bundle starting"
  );

  const run = await runPhp({ binName: "extract-bundle-symbols", args });
  const entries = await scanBundleOutputs(outputDir);

  logger.info(
    { count: entries.length, durationMs: run.durationMs },
    `extract:${category.name} done`
  );

  return { outputDir, entries, durationMs: run.durationMs };
}

async function scanBundleOutputs(outputDir: string): Promise<BundleExtractEntry[]> {
  const glob = new Bun.Glob("*.svg");
  const entries: BundleExtractEntry[] = [];
  for await (const rel of glob.scan({ cwd: outputDir })) {
    entries.push({ id: basename(rel, ".svg"), svgPath: `${outputDir}/${rel}` });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}
