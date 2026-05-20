#!/usr/bin/env bun
// Slice every top-level <use> whose composed position falls inside a given
// rectangular region of a scene SVG into a self-contained SVG file, plus
// every <defs> entry transitively referenced.

import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

const program = new Command();

program
  .name("slice-svg-region")
  .description("Extract every top-level <use> falling inside a rectangular region")
  .requiredOption("--input <file>", "source scene SVG")
  .requiredOption("--output <file>", "destination SVG path")
  .requiredOption("--x <num>", "region x", Number)
  .requiredOption("--y <num>", "region y", Number)
  .requiredOption("--width <num>", "region width", Number)
  .requiredOption("--height <num>", "region height", Number)
  .option("--exclude-character-ids <list>", "comma-separated character IDs to exclude (e.g. 477)", (s) => s.split(",").map((x) => x.trim()).filter(Boolean), [] as string[])
  .action((opts) => {
    const xml = fs.readFileSync(path.resolve(opts.input), "utf8");
    const x0 = opts.x;
    const y0 = opts.y;
    const x1 = x0 + opts.width;
    const y1 = y0 + opts.height;
    const excludeCids: string[] = opts.excludeCharacterIds ?? [];

    // Find the outer <g transform="matrix(...)"> and its translation, so we
    // can compose final positions in scene coords for every contained <use>.
    const outerGroupMatch = /<g\s+transform="matrix\(([^)]+)\)"[^>]*>/.exec(xml);
    const outerTx = outerGroupMatch ? Number(outerGroupMatch[1].split(",")[4]) : 0;
    const outerTy = outerGroupMatch ? Number(outerGroupMatch[1].split(",")[5]) : 0;

    // Match every top-level <use> (anywhere in the file — defs uses are
    // inside <g id="..."> defs, which we'll keep when transitively
    // referenced; defs uses themselves never have their own ffdec:characterId
    // in the top-level group, so this simple top-level scan is enough).
    const defsStart = xml.indexOf("<defs>");
    const top = defsStart === -1 ? xml : xml.slice(0, defsStart);

    const useRe = /<use\b[^>]*\/>/g;
    const matrixRe = /transform="matrix\(([-\d.,\s]+)\)"/;
    const widthRe = /\bwidth="([\d.]+)"/;
    const heightRe = /\bheight="([\d.]+)"/;
    const cidRe = /ffdec:characterId="(\d+)"/;
    const hrefRe = /xlink:href="#([^"]+)"/;

    const kept: { useTag: string; hrefId: string }[] = [];

    for (const m of top.matchAll(useRe)) {
      const useTag = m[0];
      const mat = matrixRe.exec(useTag);
      const w = widthRe.exec(useTag);
      const h = heightRe.exec(useTag);
      const cid = cidRe.exec(useTag);
      const href = hrefRe.exec(useTag);
      if (!mat || !w || !h || !href) continue;
      if (cid && excludeCids.includes(cid[1])) continue;
      const nums = mat[1].split(",").map(Number);
      const [a, b, c, d, tx, ty] = nums;
      const vw = Number(w[1]) * a;
      const vh = Number(h[1]) * d;
      const gx = outerTx + tx;
      const gy = outerTy + ty;
      // Bbox of the <use> in scene coords
      const ux0 = Math.min(gx, gx + vw);
      const uy0 = Math.min(gy, gy + vh);
      const ux1 = Math.max(gx, gx + vw);
      const uy1 = Math.max(gy, gy + vh);
      // Keep if it overlaps the region (any intersection).
      if (ux1 < x0 || ux0 > x1 || uy1 < y0 || uy0 > y1) continue;
      kept.push({ useTag, hrefId: href[1] });
    }

    // Walk defs transitively from each kept use's href.
    const visited = new Set<string>();
    const queue = kept.map((k) => k.hrefId);
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const defMatch = new RegExp(
        `<g\\b[^>]*\\bid="${escapeRe(id)}"[^>]*>([\\s\\S]*?)</g>`,
      ).exec(xml);
      if (!defMatch) continue;
      const innerHrefRe = /xlink:href="#([^"]+)"/g;
      let h: RegExpExecArray | null;
      while ((h = innerHrefRe.exec(defMatch[1])) !== null) {
        queue.push(h[1]);
      }
    }

    const defs: string[] = [];
    for (const id of visited) {
      const dm = new RegExp(
        `<g\\b[^>]*\\bid="${escapeRe(id)}"[^>]*>[\\s\\S]*?</g>`,
      ).exec(xml);
      if (dm) defs.push(dm[0]);
    }

    const w = opts.width;
    const h = opts.height;
    const svg =
      `<?xml version="1.0"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `xmlns:ffdec="https://www.free-decompiler.com/flash" ` +
      `viewBox="${x0 - outerTx} ${y0 - outerTy} ${w} ${h}" width="${w}" height="${h}">` +
      `<g transform="matrix(1,0,0,1,${0},${0})">${kept.map((k) => k.useTag).join("")}</g>` +
      `<defs>${defs.join("")}</defs>` +
      `</svg>`;

    fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
    fs.writeFileSync(path.resolve(opts.output), svg);
    console.log(
      `Wrote ${path.resolve(opts.output)}\n  region: (${x0},${y0}) ${w}×${h}\n  kept: ${kept.length} uses, ${defs.length} defs`,
    );
  });

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

program.parseAsync(process.argv);
