#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

import { emitManifest } from "./emit-manifest.ts";
import { parseDomDocumentBitmaps } from "./parse-xml.ts";
import { collectTransitiveSymbols, makeSymbolLoader } from "./walk-tree.ts";

const program = new Command();

program
  .name("fla-scene-extractor")
  .description("Extracts an FLA UI scene into a JSON SceneManifest")
  .requiredOption("--scene <name>", "logical scene name (e.g. login)")
  .requiredOption("--root <libraryItemName>", "root symbol library name, e.g. 'Symbol 1008'")
  .option(
    "--library <dir>",
    "FLA library directory",
    "assets/sources/fla/LIBRARY",
  )
  .option(
    "--dom-document <file>",
    "FLA DOMDocument.xml (for bitmap manifest)",
    "assets/sources/fla/DOMDocument.xml",
  )
  .option("--shapes-dir <dir>", "Directory containing swf-extracted shape SVGs", "")
  .option(
    "--shapes-public-prefix <prefix>",
    "URL prefix used by the React renderer when referencing shape SVGs",
    "",
  )
  .option(
    "--bitmaps-public-prefix <prefix>",
    "URL prefix used by the React renderer when referencing bitmaps",
    "",
  )
  .requiredOption("--out <file>", "JSON manifest output path")
  .option("--base-width <px>", "Scene base width", "800")
  .option("--base-height <px>", "Scene base height", "600")
  .action((opts) => {
    const scene: string = opts.scene;
    const root: string = opts.root;
    const libraryDir: string = path.resolve(opts.library);
    const domDoc: string = path.resolve(opts.domDocument);
    const shapesDir: string = opts.shapesDir
      ? path.resolve(opts.shapesDir)
      : path.resolve(`assets/cache/extract/ui/scenes/${scene}`);
    const shapesPublicPrefix: string = opts.shapesPublicPrefix
      || `/assets/scenes/${scene}/shapes/`;
    const bitmapsPublicPrefix: string = opts.bitmapsPublicPrefix
      || `/assets/scenes/${scene}/`;
    const baseWidth = Number(opts.baseWidth);
    const baseHeight = Number(opts.baseHeight);
    const outPath: string = path.resolve(opts.out);

    if (!fs.existsSync(libraryDir)) {
      console.error(`FLA library not found: ${libraryDir}`);
      process.exit(1);
    }

    const loader = makeSymbolLoader(libraryDir);
    const rootSym = loader(root);
    if (!rootSym) {
      console.error(`Root symbol not found in library: ${root}`);
      process.exit(1);
    }

    const symbols = collectTransitiveSymbols(root, loader);

    const bitmaps = fs.existsSync(domDoc) ? parseDomDocumentBitmaps(domDoc) : [];

    const manifest = emitManifest({
      sceneName: scene,
      rootSymbol: rootSym,
      parsedSymbols: symbols,
      bitmaps,
      shapesDir,
      shapesPublicPrefix,
      bitmapsPublicPrefix,
      baseWidth,
      baseHeight,
    });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

    const stats = {
      symbols: Object.keys(manifest.symbols).length,
      linkages: Object.keys(manifest.linkages).length,
      bitmaps: Object.keys(manifest.bitmaps).length,
      shapes: Object.keys(manifest.shapes).length,
      labelStyles: Object.keys(manifest.labelStyles).length,
    };
    console.log(
      `Wrote ${outPath}\n  symbols=${stats.symbols} linkages=${stats.linkages} bitmaps=${stats.bitmaps} shapes=${stats.shapes} labelStyles=${stats.labelStyles}`,
    );
  });

program.parseAsync(process.argv);
