#!/usr/bin/env bun
// Measures the actual visible bounding box of every <use id="..."> element in
// a scene SVG by composing its parent transforms. Output is the authoritative
// slot map for positioning React overlays.

import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

const IDENT: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function mul(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function parseMatrixAttr(transform: string | undefined): Matrix {
  if (!transform) return { ...IDENT };
  const m = /matrix\(([-\d.eE+,\s]+)\)/.exec(transform);
  if (!m) return { ...IDENT };
  const [a, b, c, d, e, f] = m[1].split(/[,\s]+/).map(Number);
  return { a, b, c, d, e, f };
}

const program = new Command();

program
  .name("extract-slot-bboxes")
  .description("Compose <use id=\"...\"> bounding boxes through nested <g> transforms in a scene SVG")
  .requiredOption("--input <file>", "Path to scene SVG (whole scene)")
  .requiredOption("--output <file>", "Output JSON with { [id]: { x, y, w, h } }")
  .action((opts) => {
    const input = path.resolve(opts.input);
    const output = path.resolve(opts.output);
    const xml = fs.readFileSync(input, "utf8");

    // We only care about top-level direct children of the outer <g>. Scene
    // SVGs from swf-searcher have a flat structure: one outer <g
    // transform=...> wrapping all top-level <use> elements; nested content
    // lives inside <defs>. Each <use id="...">'s position in the rendered
    // image is `outerTransform * useTransform * (useWidth, useHeight rect)`.

    // Extract the outer <g transform=...> matrix.
    const outerMatch = /<g\s+transform="([^"]+)">/.exec(xml);
    const outer = parseMatrixAttr(outerMatch?.[1]);

    // Find every top-level <use id="..." ...>. Each is self-closing on its
    // own with width, height, transform, id attributes.
    const USE_RE =
      /<use\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"[^>]*\btransform="([^"]+)"[^>]*\bid="([^"]+)"[^>]*\/>/g;

    const slots: Record<string, { x: number; y: number; w: number; h: number }> = {};
    let m: RegExpExecArray | null;
    while ((m = USE_RE.exec(xml)) !== null) {
      const w0 = Number(m[1]);
      const h0 = Number(m[2]);
      const useMx = parseMatrixAttr(m[3]);
      const id = m[4];
      const composed = mul(outer, useMx);
      const x = composed.e;
      const y = composed.f;
      const w = w0 * composed.a;
      const h = h0 * composed.d;
      slots[id] = {
        x: round(x),
        y: round(y),
        w: round(w),
        h: round(h),
      };
    }

    fs.mkdirSync(path.dirname(output), { recursive: true });
    const sortedKeys = Object.keys(slots).sort();
    const sorted: Record<string, unknown> = {};
    for (const k of sortedKeys) sorted[k] = slots[k];
    fs.writeFileSync(output, JSON.stringify(sorted, null, 2));
    console.log(`Wrote ${output} with ${sortedKeys.length} slots.`);
  });

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

program.parseAsync(process.argv);
