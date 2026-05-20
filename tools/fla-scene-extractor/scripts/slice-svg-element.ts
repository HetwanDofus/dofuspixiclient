#!/usr/bin/env bun
// Extracts a single named `<use id="...">` (and only the defs it transitively
// references) from a swf-searcher scene SVG into a standalone SVG file.

import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

const program = new Command();

program
  .name("slice-svg-element")
  .description("Slice a named <use id=\"...\"> subtree from a scene SVG")
  .requiredOption("--input <file>", "source scene SVG")
  .requiredOption("--id <id>", "id of the <use> to slice")
  .requiredOption("--output <file>", "output SVG path")
  .action((opts) => {
    const xml = fs.readFileSync(path.resolve(opts.input), "utf8");
    const targetId: string = opts.id;
    const out = path.resolve(opts.output);

    // Find <use id="targetId"> element.
    const useRe = new RegExp(
      `<use\\b[^>]*\\bid="${escapeRe(targetId)}"[^>]*\\/>`,
    );
    const useMatch = useRe.exec(xml);
    if (!useMatch) {
      console.error(`Element id="${targetId}" not found`);
      process.exit(1);
    }
    const useTag = useMatch[0];

    // Extract its href and bounding width/height.
    const hrefMatch = /xlink:href="#([^"]+)"/.exec(useTag);
    const wMatch = /\bwidth="([\d.]+)"/.exec(useTag);
    const hMatch = /\bheight="([\d.]+)"/.exec(useTag);
    if (!hrefMatch) {
      console.error("Use element has no xlink:href");
      process.exit(1);
    }
    const rootObjectId = hrefMatch[1];
    const width = wMatch ? Number(wMatch[1]) : 100;
    const height = hMatch ? Number(hMatch[1]) : 100;

    // Recursively gather referenced object IDs.
    const visited = new Set<string>();
    const queue = [rootObjectId];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const defMatch = new RegExp(
        `<g\\b[^>]*\\bid="${escapeRe(id)}"[^>]*>([\\s\\S]*?)</g>`,
      ).exec(xml);
      if (!defMatch) continue;
      const body = defMatch[1];
      const hrefRe = /xlink:href="#([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = hrefRe.exec(body)) !== null) {
        queue.push(m[1]);
      }
    }

    // Collect each visited <g id="..."> block.
    const defs: string[] = [];
    for (const id of visited) {
      const defMatch = new RegExp(
        `<g\\b[^>]*\\bid="${escapeRe(id)}"[^>]*>[\\s\\S]*?</g>`,
      ).exec(xml);
      if (defMatch) defs.push(defMatch[0]);
    }

    const svg =
      `<?xml version="1.0"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `xmlns:ffdec="https://www.free-decompiler.com/flash" ` +
      `width="${width}px" height="${height}px" viewBox="0 0 ${width} ${height}">` +
      `<use xlink:href="#${rootObjectId}" width="${width}" height="${height}"/>` +
      `<defs>${defs.join("")}</defs>` +
      `</svg>`;

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, svg);
    console.log(
      `Wrote ${out}  (${width}x${height}, ${visited.size} defs from ${rootObjectId})`,
    );
  });

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

program.parseAsync(process.argv);
