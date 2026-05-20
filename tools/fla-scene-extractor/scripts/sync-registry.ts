#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

import type { SceneManifest } from "../src/types.ts";

const program = new Command();

program
  .name("sync-registry")
  .description(
    "Syncs a scene manifest + its referenced shape SVGs into the scene-consumer package.",
  )
  .requiredOption("--manifest <file>", "Path to scene manifest JSON")
  .requiredOption("--shapes-dir <dir>", "Source directory of extracted shape SVGs")
  .requiredOption(
    "--registry-scenes-dir <dir>",
    "Target scenes/<scene> dir inside scene-consumer",
  )
  .requiredOption(
    "--registry-public-dir <dir>",
    "Target public/assets/scenes/<scene> dir inside scene-consumer",
  )
  .action((opts) => {
    const manifestPath: string = path.resolve(opts.manifest);
    const shapesDir: string = path.resolve(opts.shapesDir);
    const sceneDir: string = path.resolve(opts.registryScenesDir);
    const publicDir: string = path.resolve(opts.registryPublicDir);

    if (!fs.existsSync(manifestPath)) {
      console.error(`Manifest not found: ${manifestPath}`);
      process.exit(1);
    }

    const manifest: SceneManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    fs.mkdirSync(sceneDir, { recursive: true });
    fs.mkdirSync(path.join(publicDir, "shapes"), { recursive: true });

    // 1. Drop descriptor.json into the registry scene dir.
    fs.writeFileSync(
      path.join(sceneDir, "descriptor.json"),
      JSON.stringify(manifest, null, 2),
    );

    // 2. Copy each referenced shape SVG into public/assets/scenes/<scene>/shapes/.
    let copiedShapes = 0;
    let missingShapes = 0;
    for (const [ref] of Object.entries(manifest.shapes)) {
      const src = path.join(shapesDir, ref);
      const dst = path.join(publicDir, "shapes", ref);
      if (!fs.existsSync(src)) {
        console.warn(`  missing shape SVG: ${ref}`);
        missingShapes++;
        continue;
      }
      fs.copyFileSync(src, dst);
      copiedShapes++;
    }

    console.log(
      `Synced scene "${manifest.scene}" to ${sceneDir}.\n  shapes copied: ${copiedShapes} (missing: ${missingShapes})`,
    );
  });

program.parseAsync(process.argv);
