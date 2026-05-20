#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

// Strips top-level <use id="..."> elements from a swf-extracted scene SVG.
// Goal: keep only "chrome" (panel art, decoration, character illustrations,
// raw frame pieces) so the surrounding React component can supply real HTML
// for every interactive label/button/input.

const program = new Command();

program
  .name("strip-scene-svg")
  .description("Remove specific <use id=\"...\"> elements from a scene SVG")
  .requiredOption("--input <file>", "Source SVG (whole scene, swf-searcher output)")
  .requiredOption("--output <file>", "Destination SVG (chrome only)")
  .option(
    "--strip <ids>",
    "Comma-separated list of element IDs to remove",
    (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean),
    [] as string[],
  )
  .option(
    "--strip-prefix <prefixes>",
    "Comma-separated list of ID prefixes to remove (e.g. _btn,_lbl,_ti)",
    (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean),
    [] as string[],
  )
  .action((opts) => {
    const input = path.resolve(opts.input);
    const output = path.resolve(opts.output);
    const stripExact: string[] = opts.strip ?? [];
    const stripPrefix: string[] = opts.stripPrefix ?? [];

    if (!fs.existsSync(input)) {
      console.error(`Input SVG not found: ${input}`);
      process.exit(1);
    }

    const xml = fs.readFileSync(input, "utf8");

    // Each top-level <use> in swf-searcher's output is self-closing and on its
    // own logical chunk. We match `<use ... id="..." ... />` and decide based
    // on the id whether to drop it. Internal <defs> are left intact — they
    // may become unreferenced but that's harmless for rendering.
    const USE_RE = /<use\b[^>]*\bid="([^"]+)"[^>]*\/>/g;
    let droppedExact = 0;
    let droppedPrefix = 0;

    const out = xml.replace(USE_RE, (match, id: string) => {
      if (stripExact.includes(id)) {
        droppedExact++;
        return "";
      }
      if (stripPrefix.some((p) => id.startsWith(p))) {
        droppedPrefix++;
        return "";
      }
      return match;
    });

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, out);
    const before = xml.length;
    const after = out.length;
    console.log(
      `Wrote ${output}\n  size: ${before}B -> ${after}B (-${before - after}B)\n  dropped: ${droppedExact} exact + ${droppedPrefix} by prefix`,
    );
  });

program.parseAsync(process.argv);
