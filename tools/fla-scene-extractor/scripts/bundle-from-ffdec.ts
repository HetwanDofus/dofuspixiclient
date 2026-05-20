#!/usr/bin/env bun
// Bundles raw scene assets from an FFDec export of core.swf.
//
// FFDec output layout (`-export shape,sprite,image,script,symbolClass`):
//   sprites/DefineSprite_<id>[_<className>]/<frame>.svg     1:1 sprite per frame
//   shapes/<id>.svg                                          standalone shape
//   images/<id>.png|.jpg                                     bitmap (optional .alpha.png)
//   scripts/DefineSprite_<id>_<className>/frame_N/...        AS code per place
//   symbolClass/symbols.csv                                  <id>;"<ClassName>"
//
// This script produces, per scene, the same scenes-source folder layout the
// previous bundler did, but with 1:1 FFDec assets and the per-instance AS
// scripts copied alongside.

import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

import type { SceneManifest } from "../src/types.ts";

const program = new Command();

program
  .name("bundle-from-ffdec")
  .description("Bundle scene assets from FFDec output")
  .requiredOption("--scene <name>", "logical scene name")
  .requiredOption("--scene-class <name>", "SWF symbol class name of the scene root")
  .requiredOption("--descriptor <file>", "scene descriptor JSON")
  .requiredOption("--ffdec-dir <dir>", "FFDec export directory")
  .requiredOption("--fla-bitmaps-dir <dir>", "Original FLA bitmap directory")
  .requiredOption("--out <dir>", "output bundle directory")
  .action((opts) => {
    const sceneClass: string = opts.sceneClass;
    const descriptor: SceneManifest = JSON.parse(
      fs.readFileSync(path.resolve(opts.descriptor), "utf8"),
    );
    const ffdecDir = path.resolve(opts.ffdecDir);
    const flaBitmapsDir = path.resolve(opts.flaBitmapsDir);
    const outDir = path.resolve(opts.out);

    const symbolCsv = path.join(ffdecDir, "symbolClass", "symbols.csv");
    const nameToId = parseSymbolCsv(symbolCsv);

    fs.mkdirSync(path.join(outDir, "parts"), { recursive: true });
    fs.mkdirSync(path.join(outDir, "bitmaps"), { recursive: true });
    fs.mkdirSync(path.join(outDir, "scripts"), { recursive: true });

    // 1. Scene full.svg — sprite SVG of the scene class.
    const sceneId = nameToId.get(sceneClass);
    if (!sceneId) bail(`Symbol class not found in symbols.csv: ${sceneClass}`);
    const sceneSpriteDir = findSpriteDir(ffdecDir, sceneId, sceneClass);
    if (!sceneSpriteDir) bail(`Sprite folder not found for ${sceneClass} (id=${sceneId})`);
    const sceneFrame = path.join(sceneSpriteDir, "1.svg");
    if (!fs.existsSync(sceneFrame)) bail(`Scene SVG missing: ${sceneFrame}`);
    fs.copyFileSync(sceneFrame, path.join(outDir, "full.svg"));

    // 2. parts/<linkage>.svg — sprite (or shape) SVG per FLA linkage.
    const partsCopied: { name: string; id: string; w?: number; h?: number }[] = [];
    const partsMissing: string[] = [];
    for (const linkageName of Object.keys(descriptor.linkages).sort()) {
      const id = nameToId.get(linkageName);
      if (!id) {
        partsMissing.push(linkageName);
        continue;
      }
      const dir = findSpriteDir(ffdecDir, id, linkageName);
      const fromSprite = dir ? path.join(dir, "1.svg") : null;
      const fromShape = path.join(ffdecDir, "shapes", `${id}.svg`);
      const src = fromSprite && fs.existsSync(fromSprite)
        ? fromSprite
        : fs.existsSync(fromShape)
          ? fromShape
          : null;
      if (!src) {
        partsMissing.push(`${linkageName} (id=${id}, no svg)`);
        continue;
      }
      const dst = path.join(outDir, "parts", `${linkageName}.svg`);
      fs.copyFileSync(src, dst);
      const dims = readSvgDimensions(src);
      partsCopied.push({ name: linkageName, id, w: dims.w, h: dims.h });
    }

    // 3. bitmaps — from FLA library (already 1:1 with the descriptor bitmap names).
    const bitmapsCopied: string[] = [];
    const bitmapsMissing: string[] = [];
    for (const bitmapName of Object.keys(descriptor.bitmaps).sort()) {
      const src = path.join(flaBitmapsDir, bitmapName);
      if (!fs.existsSync(src)) {
        bitmapsMissing.push(bitmapName);
        continue;
      }
      fs.copyFileSync(src, path.join(outDir, "bitmaps", bitmapName));
      bitmapsCopied.push(bitmapName);
    }

    // 4. scripts — copy the per-instance on(construct) handlers for this scene.
    const scriptsCopied = copyScripts(
      path.join(ffdecDir, "scripts", path.basename(sceneSpriteDir)),
      path.join(outDir, "scripts"),
    );

    // 5. layout.json + slots.json — preserve the FLA-sourced descriptor.
    fs.copyFileSync(
      path.resolve(opts.descriptor),
      path.join(outDir, "layout.json"),
    );

    // 6. README.md
    fs.writeFileSync(
      path.join(outDir, "README.md"),
      renderReadme({
        sceneClass,
        sceneId,
        sceneDims: readSvgDimensions(sceneFrame),
        partsCopied,
        partsMissing,
        bitmapsCopied,
        bitmapsMissing,
        scriptsCopied,
      }),
    );

    console.log(
      `Wrote ${outDir}\n  full.svg (id=${sceneId} ${sceneClass})\n  parts: ${partsCopied.length} (missing ${partsMissing.length})\n  bitmaps: ${bitmapsCopied.length} (missing ${bitmapsMissing.length})\n  scripts: ${scriptsCopied}`,
    );
    if (partsMissing.length) console.warn("  missing parts:", partsMissing.join(", "));
    if (bitmapsMissing.length) console.warn("  missing bitmaps:", bitmapsMissing.join(", "));
  });

function parseSymbolCsv(csvPath: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(csvPath)) return out;
  for (const line of fs.readFileSync(csvPath, "utf8").split(/\r?\n/)) {
    const m = /^(\d+);"([^"]+)"/.exec(line.trim());
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

function findSpriteDir(
  ffdecDir: string,
  id: string,
  className: string,
): string | null {
  const withClass = path.join(ffdecDir, "sprites", `DefineSprite_${id}_${className}`);
  if (fs.existsSync(withClass)) return withClass;
  const noClass = path.join(ffdecDir, "sprites", `DefineSprite_${id}`);
  if (fs.existsSync(noClass)) return noClass;
  return null;
}

function readSvgDimensions(svgPath: string): { w?: number; h?: number } {
  try {
    const head = fs.readFileSync(svgPath, "utf8").slice(0, 2000);
    const w = /\bwidth="([\d.]+)px?/.exec(head)?.[1];
    const h = /\bheight="([\d.]+)px?/.exec(head)?.[1];
    return {
      w: w !== undefined ? Number(w) : undefined,
      h: h !== undefined ? Number(h) : undefined,
    };
  } catch {
    return {};
  }
}

function copyScripts(srcDir: string, dstDir: string): number {
  if (!fs.existsSync(srcDir)) return 0;
  let count = 0;
  const walk = (rel: string) => {
    const abs = path.join(srcDir, rel);
    for (const entry of fs.readdirSync(abs)) {
      const stat = fs.statSync(path.join(abs, entry));
      if (stat.isDirectory()) {
        walk(path.join(rel, entry));
      } else if (entry.endsWith(".as")) {
        const dst = path.join(dstDir, rel, entry);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(abs, entry), dst);
        count++;
      }
    }
  };
  walk("");
  return count;
}

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function renderReadme(args: {
  sceneClass: string;
  sceneId: string;
  sceneDims: { w?: number; h?: number };
  partsCopied: { name: string; id: string; w?: number; h?: number }[];
  partsMissing: string[];
  bitmapsCopied: string[];
  bitmapsMissing: string[];
  scriptsCopied: number;
}): string {
  return [
    `# ${args.sceneClass}`,
    "",
    `Scene assets extracted with FFDec (JPEXS Free Flash Decompiler) from`,
    `\`assets/sources/core.swf\`. Root sprite: SWF char #${args.sceneId} (\`${args.sceneClass}\`),`,
    `${args.sceneDims.w}px × ${args.sceneDims.h}px.`,
    "",
    "## Files",
    "",
    "- `full.svg` — full sprite rendering from FFDec. Internal `<use>` references",
    "  carry `ffdec:characterId` so you can trace back to any sub-symbol.",
    "- `parts/<linkage>.svg` — per AS-export linkage, 1:1 from FFDec (sprite or",
    "  shape — whichever the symbol is).",
    "- `bitmaps/Bitmap *.png|jpg` — bitmap fills referenced by the FLA descriptor,",
    "  copied straight from the FLA library (matches descriptor exactly).",
    "- `scripts/` — per-instance `on(construct){…}` AS source extracted by FFDec.",
    "  This is the runtime logic that sets each label's text, styleName, and any",
    "  initial visibility / event handlers. Use it to mirror the original",
    "  runtime behaviour when you rebuild the scene.",
    "- `layout.json` — FLA descriptor: every `<DOMSymbolInstance>` parsed out",
    "  with its matrix, AS3 `on(construct){}` properties, and the bitmap manifest.",
    "",
    "## Parts copied",
    "",
    args.partsCopied
      .map(
        (p) =>
          `- ${p.name} (id=${p.id}${p.w !== undefined ? `, ${p.w.toFixed(1)}×${p.h?.toFixed(1)}` : ""})`,
      )
      .join("\n"),
    args.partsMissing.length
      ? `\n## Parts missing (no class entry in symbols.csv)\n\n${args.partsMissing.map((p) => `- ${p}`).join("\n")}\n`
      : "",
    "",
    "## Bitmaps copied",
    "",
    args.bitmapsCopied.map((b) => `- ${b}`).join("\n"),
    args.bitmapsMissing.length
      ? `\n## Bitmaps missing\n\n${args.bitmapsMissing.map((b) => `- ${b}`).join("\n")}\n`
      : "",
    "",
    `## Scripts copied: ${args.scriptsCopied}`,
    "",
    "## Notes",
    "",
    "- `full.svg` is the design-time render — every element is visible. AS3",
    "  controls runtime visibility (`_visible`, `setSize`, child positioning).",
    "  Inspect `scripts/` for the per-instance `on(construct)` handlers to find",
    "  which elements default to hidden, which load dynamic text, etc.",
    "- Most chrome (panels, button skins, input boxes) can be ported to",
    "  HTML/CSS. SVG ports must be 1:1: same path data, same fills, same",
    "  gradient endpoints, same stroke weights.",
    "",
  ].join("\n");
}

program.parseAsync(process.argv);
