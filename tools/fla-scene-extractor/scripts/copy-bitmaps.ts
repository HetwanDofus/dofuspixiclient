#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

import type { SceneManifest } from "../src/types.ts";

const program = new Command();

program
  .name("copy-bitmaps")
  .description("Copies bitmaps referenced by a scene manifest into target public dirs")
  .requiredOption("--manifest <file>", "Path to scene manifest JSON")
  .requiredOption(
    "--source-dir <dir>",
    "Directory containing FLA bitmaps (Bitmap N.png|jpg)",
  )
  .option(
    "--target-dir <dir...>",
    "One or more target directories to copy bitmaps into",
    [] as string[],
  )
  .action((opts) => {
    const manifestPath: string = path.resolve(opts.manifest);
    const sourceDir: string = path.resolve(opts.sourceDir);
    const targets: string[] = (opts.targetDir as string[]).map((t) => path.resolve(t));

    if (!fs.existsSync(manifestPath)) {
      console.error(`Manifest not found: ${manifestPath}`);
      process.exit(1);
    }
    if (targets.length === 0) {
      console.error("Provide at least one --target-dir");
      process.exit(1);
    }

    const manifest: SceneManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    let copied = 0;
    let skipped = 0;
    for (const [, entry] of Object.entries(manifest.bitmaps)) {
      const filename = path.basename(entry.file);
      const src = path.join(sourceDir, filename);
      if (!fs.existsSync(src)) {
        console.warn(`  missing source bitmap: ${filename}`);
        skipped++;
        continue;
      }
      for (const target of targets) {
        const dst = path.join(target, filename);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
      copied++;
    }
    console.log(
      `Copied ${copied} bitmap(s) to ${targets.length} target(s). Skipped: ${skipped}.`,
    );
  });

program.parseAsync(process.argv);
