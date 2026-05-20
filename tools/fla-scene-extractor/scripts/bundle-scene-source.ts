#!/usr/bin/env bun
// Bundles every raw asset needed to hand-build a scene into a single folder:
//   - full.svg          (Flash-rendered whole scene by SWF export name)
//   - parts/<name>.svg  (each FLA linkage identifier resolved to its SWF char)
//   - bitmaps/*.png|jpg (raster files referenced by the scene)
//   - layout.json       (FLA descriptor: positions, sizes, AS3 metadata)
//   - slots.json        (composed scene-space bounding boxes per element id)

import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

import type { SceneManifest } from "../src/types.ts";

type SwfManifestChar = {
  id: number;
  exportName: string | null;
  type: string;
  width: number;
  height: number;
  frames: { index: number; file: string }[];
};

type SwfManifest = {
  characters: Record<string, SwfManifestChar>;
};

const program = new Command();

program
  .name("bundle-scene-source")
  .description("Collect raw SVGs + bitmaps + layout for hand-building a scene")
  .requiredOption("--scene <name>", "logical scene name (login, server-select, character-select)")
  .requiredOption("--scene-export-name <name>", "SWF export name of the scene root (e.g. UI_Login)")
  .requiredOption("--descriptor <file>", "scene descriptor JSON (from fla-scene-extractor cli)")
  .requiredOption("--swf-manifest <file>", "swf-searcher manifest.json of the all-SVG dump")
  .requiredOption("--svg-dir <dir>", "directory holding swf-searcher SVGs")
  .requiredOption("--bitmaps-dir <dir>", "directory holding FLA bitmap files")
  .requiredOption("--slots <file>", "slots.json (from extract-slot-bboxes.ts)")
  .requiredOption("--out <dir>", "output bundle directory for this scene")
  .action((opts) => {
    const sceneExportName: string = opts.sceneExportName;
    const descriptorPath = path.resolve(opts.descriptor);
    const swfManifestPath = path.resolve(opts.swfManifest);
    const svgDir = path.resolve(opts.svgDir);
    const bitmapsDir = path.resolve(opts.bitmapsDir);
    const slotsPath = path.resolve(opts.slots);
    const outDir = path.resolve(opts.out);

    if (!fs.existsSync(descriptorPath)) bail(`Missing descriptor: ${descriptorPath}`);
    if (!fs.existsSync(swfManifestPath)) bail(`Missing swf manifest: ${swfManifestPath}`);

    const descriptor: SceneManifest = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    const swfManifest: SwfManifest = JSON.parse(fs.readFileSync(swfManifestPath, "utf8"));

    // Build exportName -> char index.
    const byExport = new Map<string, SwfManifestChar>();
    for (const ch of Object.values(swfManifest.characters)) {
      if (ch.exportName) byExport.set(ch.exportName, ch);
    }

    fs.mkdirSync(path.join(outDir, "parts"), { recursive: true });
    fs.mkdirSync(path.join(outDir, "bitmaps"), { recursive: true });

    // 1. full.svg — the whole scene by export name.
    const rootChar = byExport.get(sceneExportName);
    if (!rootChar) bail(`SWF export not found: ${sceneExportName}`);
    const rootSvg = path.join(svgDir, rootChar.frames[0].file);
    if (!fs.existsSync(rootSvg)) bail(`Missing root SVG: ${rootSvg}`);
    fs.copyFileSync(rootSvg, path.join(outDir, "full.svg"));

    // 2. parts/<exportName>.svg — every linkage in the scene descriptor.
    const partsCopied: string[] = [];
    const partsMissing: string[] = [];
    for (const linkageName of Object.keys(descriptor.linkages).sort()) {
      const ch = byExport.get(linkageName);
      if (!ch) {
        partsMissing.push(linkageName);
        continue;
      }
      const src = path.join(svgDir, ch.frames[0].file);
      if (!fs.existsSync(src)) {
        partsMissing.push(`${linkageName} (no svg file)`);
        continue;
      }
      const dst = path.join(outDir, "parts", `${linkageName}.svg`);
      fs.copyFileSync(src, dst);
      partsCopied.push(`${linkageName} (id=${ch.id}, ${ch.width.toFixed(1)}x${ch.height.toFixed(1)})`);
    }

    // 3. bitmaps/* — copy referenced bitmaps from FLA LIBRARY.
    const bitmapsCopied: string[] = [];
    const bitmapsMissing: string[] = [];
    for (const bitmapName of Object.keys(descriptor.bitmaps).sort()) {
      const src = path.join(bitmapsDir, bitmapName);
      if (!fs.existsSync(src)) {
        bitmapsMissing.push(bitmapName);
        continue;
      }
      const dst = path.join(outDir, "bitmaps", bitmapName);
      fs.copyFileSync(src, dst);
      bitmapsCopied.push(bitmapName);
    }

    // 4. layout.json — the full FLA descriptor (positions + AS3 metadata).
    fs.writeFileSync(
      path.join(outDir, "layout.json"),
      JSON.stringify(descriptor, null, 2),
    );

    // 5. slots.json — composed scene-space bounding boxes (raw transforms).
    if (fs.existsSync(slotsPath)) {
      fs.copyFileSync(slotsPath, path.join(outDir, "slots.json"));
    }

    // 6. README.md
    const readme = renderReadme({
      sceneExportName,
      rootChar,
      descriptor,
      partsCopied,
      partsMissing,
      bitmapsCopied,
      bitmapsMissing,
    });
    fs.writeFileSync(path.join(outDir, "README.md"), readme);

    console.log(
      `Wrote ${outDir}\n  full.svg (SWF #${rootChar.id} ${sceneExportName})\n  parts: ${partsCopied.length} (missing ${partsMissing.length})\n  bitmaps: ${bitmapsCopied.length} (missing ${bitmapsMissing.length})`,
    );
    if (partsMissing.length) console.warn("  missing parts:", partsMissing.join(", "));
    if (bitmapsMissing.length) console.warn("  missing bitmaps:", bitmapsMissing.join(", "));
  });

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function renderReadme(args: {
  sceneExportName: string;
  rootChar: SwfManifestChar;
  descriptor: SceneManifest;
  partsCopied: string[];
  partsMissing: string[];
  bitmapsCopied: string[];
  bitmapsMissing: string[];
}): string {
  return [
    `# ${args.sceneExportName}`,
    "",
    `Flash-rendered scene assets extracted from \`assets/sources/core.swf\`.`,
    `Root sprite: SWF character #${args.rootChar.id} (\`${args.sceneExportName}\`), `,
    `${args.rootChar.width.toFixed(1)}px × ${args.rootChar.height.toFixed(1)}px`,
    `(offset ${args.rootChar.frames[0] ? "see manifest" : "n/a"}).`,
    "",
    "## Files",
    "",
    "- `full.svg` — whole scene as rendered by Flash. Use as visual reference",
    "  or paste-in background. Internal `<use id=\"_xxx\">` markers preserve the",
    "  original FLA instance names (`_tiAccount`, `_btnOK`, …).",
    "- `parts/<linkage>.svg` — each named library symbol that the FLA scene",
    "  references (button skins, eggs, label sprite, text input frame, etc.).",
    "  These are the building blocks if you want to recompose by hand.",
    "- `bitmaps/Bitmap *.png|jpg` — raster assets referenced as `<BitmapFill>` in",
    "  the FLA. Server name banners, large background art, etc.",
    "- `layout.json` — FLA descriptor: every `<DOMSymbolInstance>` parsed out",
    "  with its matrix, AS3 `on(construct){}` properties (styleName, text,",
    "  backgroundUp/Down, enabled, …), and resolved label-style table.",
    "- `slots.json` — flat `{ id: {x,y,w,h} }` map of every `<use id=\"...\">` ",
    "  in `full.svg`, with the outer scene transform composed in. Coordinates",
    "  are scene-local pixels.",
    "",
    "## AS3 metadata of named instances (text/styleName/skin refs)",
    "",
    "See `layout.json#symbols[<scene-root>].layers[].nodes[].props`. Common keys:",
    "- `styleName` — stylesheet entry name (font, size, color, alignment)",
    "- `text` — default text (usually empty; AS3 fills at runtime)",
    "- `backgroundUp` / `backgroundDown` — button skin export names",
    "- `enabled`, `multiline`, `wordWrap`, `html`, `icon`",
    "",
    "## Parts copied",
    "",
    args.partsCopied.map((p) => `- ${p}`).join("\n"),
    args.partsMissing.length
      ? `\n## Parts missing (no SWF export by that name)\n\n${args.partsMissing.map((p) => `- ${p}`).join("\n")}\n`
      : "",
    "",
    "## Bitmaps copied",
    "",
    args.bitmapsCopied.map((b) => `- ${b}`).join("\n"),
    args.bitmapsMissing.length
      ? `\n## Bitmaps missing\n\n${args.bitmapsMissing.map((b) => `- ${b}`).join("\n")}\n`
      : "",
    "",
    "## Notes",
    "",
    "- `full.svg` wraps everything in `<g transform=\"matrix(1,0,0,1,0,Y)\">` (the",
    "  SWF character offset). Coordinates inside individual `<use>` elements are",
    "  pre-offset; coordinates in `slots.json` are *post*-offset (final visual).",
    "- The Flash renderer baked masks, alpha, and color transforms into the SVG",
    "  pixel output. Sub-symbols rendered standalone in `parts/` will NOT clip",
    "  against the parent's mask layers.",
    "- AS3 controls runtime visibility (advanced login mode, news carousel,",
    "  members overlay, …). The FLA design-time state shows all of them; you",
    "  may need to manually hide some when composing a final scene.",
    "",
  ].join("\n");
}

program.parseAsync(process.argv);
