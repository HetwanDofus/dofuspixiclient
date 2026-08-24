#!/usr/bin/env bun
/**
 * Recompute the `viewBox` of already-published, pipeline-extracted SVGs.
 *
 * The PHP extractor crops each SVG to its content by walking the top-level
 * `<use>` elements — but it derived each one's extent from `sqrt(a²+b²)`
 * and grew the box rightwards/downwards from the matrix translation. That
 * is only correct when the matrix neither mirrors nor rotates. A mirrored
 * placement (`a < 0`, very common: Ankama flipped symbols instead of
 * authoring a second one) runs *leftwards* from `tx`, so the box landed on
 * the wrong side of the origin and the crop cut the drawing away. The
 * Chienchien (`items/18/6.svg`) was the reported case: 40 units wide, with
 * the whole dog sitting at x −0.1…35.9 and the viewBox at 33.9…73.9.
 *
 * `ExtractItemsCommand::cropSvgToContent` (and its copies in the static and
 * accessories commands) is fixed, so a re-extraction is correct — but the
 * extractor needs retail SWFs that are not in this repo, and the *published*
 * SVGs are. This script applies the same corrected crop to those outputs
 * directly, so the fix does not wait on a pipeline run.
 *
 * It is idempotent: an SVG whose viewBox already contains its content is
 * left untouched, byte for byte.
 *
 *   bun run scripts/recrop-svg-viewbox.ts --check          # report only
 *   bun run scripts/recrop-svg-viewbox.ts                  # rewrite
 *   bun run scripts/recrop-svg-viewbox.ts <dir> [<dir>...] # other roots
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Same 2-unit margin `cropSvgToContent` adds. */
const PAD = 2;

/** Published roots that came out of the PHP extractor's crop path. */
const DEFAULT_ROOTS = ["apps/electrobun/public/assets/items"];

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bounding box of the top-level `<use>` elements, in the SVG's own user
 * units. The extractor normalises every symbol in `<defs>` so its own box
 * is `(0,0,width,height)` — the `width`/`height` on the `<use>` — so
 * transforming those four corners gives the drawing's extent without
 * having to resolve the referenced group. Verified against the browser's
 * `getBBox()` on a 50-icon sample: never smaller than the true box, never
 * more than ~1.6 units larger.
 */
export function contentBox(svg: string): Box | null {
  const defsAt = svg.indexOf("<defs");
  const head = defsAt === -1 ? svg : svg.slice(0, defsAt);
  const box: Box = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  let found = false;

  for (const tag of head.matchAll(/<use\b[^>]*\/>/g)) {
    const el = tag[0];
    const w = Number(/\bwidth="([^"]+)"/.exec(el)?.[1]);
    const h = Number(/\bheight="([^"]+)"/.exec(el)?.[1]);
    const m = /\btransform="matrix\(([^)]+)\)"/.exec(el)?.[1];
    if (!m || !Number.isFinite(w) || !Number.isFinite(h)) {
      continue;
    }
    const [a, b, c, d, tx, ty] = m.split(/[,\s]+/).map(Number);
    if ([a, b, c, d, tx, ty].some((n) => !Number.isFinite(n))) {
      continue;
    }
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ] as const) {
      const px = a * x + c * y + tx;
      const py = b * x + d * y + ty;
      box.minX = Math.min(box.minX, px);
      box.maxX = Math.max(box.maxX, px);
      box.minY = Math.min(box.minY, py);
      box.maxY = Math.max(box.maxY, py);
    }
    found = true;
  }

  return found && box.maxX > box.minX && box.maxY > box.minY ? box : null;
}

/**
 * The rewritten SVG, or `null` when the current viewBox already contains
 * the whole drawing — a loose-but-containing box is not a defect and is
 * left alone rather than churned.
 */
export function recrop(svg: string): string | null {
  const vb = /viewBox="([-\d.eE\s]+)"/.exec(svg);
  const box = contentBox(svg);
  if (!vb || !box) {
    return null;
  }
  const [vx, vy, vw, vh] = vb[1].trim().split(/\s+/).map(Number);
  if (
    box.minX >= vx &&
    box.minY >= vy &&
    box.maxX <= vx + vw &&
    box.maxY <= vy + vh
  ) {
    return null;
  }

  const w = box.maxX - box.minX + PAD * 2;
  const h = box.maxY - box.minY + PAD * 2;
  const f = (n: number) => n.toFixed(1);
  return svg.replace(
    /(<svg[^>]*?)\swidth="[^"]*"\s+height="[^"]*"\s+viewBox="[^"]*"/,
    `$1 width="${f(w)}" height="${f(h)}" viewBox="${f(box.minX - PAD)} ${f(
      box.minY - PAD
    )} ${f(w)} ${f(h)}"`
  );
}

async function main() {
  const args = Bun.argv.slice(2);
  const check = args.includes("--check");
  const roots = args.filter((a) => !a.startsWith("--"));

  let scanned = 0;
  const changed: string[] = [];

  for (const root of roots.length > 0 ? roots : DEFAULT_ROOTS) {
    const glob = new Bun.Glob("**/*.svg");
    for await (const rel of glob.scan({ cwd: resolve(root) })) {
      const path = resolve(root, rel);
      const svg = await readFile(path, "utf-8");
      scanned++;
      const fixed = recrop(svg);
      if (fixed === null || fixed === svg) {
        continue;
      }
      changed.push(`${root}/${rel}`);
      if (!check) {
        await writeFile(path, fixed);
      }
    }
  }

  const verb = check ? "would rewrite" : "rewrote";
  console.log(`scanned ${scanned} svg, ${verb} ${changed.length}`);
  for (const p of changed.slice(0, 10)) {
    console.log(`  ${p}`);
  }
  if (changed.length > 10) {
    console.log(`  … and ${changed.length - 10} more`);
  }
  if (check && changed.length > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
