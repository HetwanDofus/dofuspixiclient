import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { logger } from "../../logger.ts";
import { paths } from "../../paths.ts";
import type {
  PointFrame,
  PointManifest,
} from "../extract/points.ts";

/** All (style, type) pairs the canonical client ships:
 *    style 0 = normal hits, 1 = criticals
 *    type  0..4 = damage / AP / MP / heal / shield (CLIP_POINT_TYPE_*) */
const POINT_PAIRS: Array<{ style: number; type: number }> = (() => {
  const out: Array<{ style: number; type: number }> = [];
  for (const style of [0, 1]) {
    for (const type of [0, 1, 2, 3, 4]) out.push({ style, type });
  }
  return out;
})();

/**
 * Compile JSON point manifests → CSS @keyframes + per-clip wiring,
 * written to `apps/electrobun/src/hud/fight/points.generated.css`.
 *
 * Why CSS instead of runtime interpolation:
 *   - The animation IS data (the SWF matrix curve + cxform). We
 *     translate it once at build time; the browser's animation
 *     engine handles every frame at the GPU compositor.
 *   - Zero runtime cost beyond a className lookup at spawn.
 *   - Adding a new (style, type) means dropping a JSON in
 *     `assets/dofassets/points/` and running this stage — no code
 *     changes.
 *
 * Output structure for each (style, type):
 *
 *   .dofus-point--<s>-<t> {
 *     animation:
 *       dofus-point-<s>-<t>-curve  <duration>ms linear forwards;
 *   }
 *   .dofus-point--<s>-<t> .dofus-point__bright {
 *     // either static color (identity cxform) ...
 *     --bright-color: rgb(R, G, B);
 *     // ... or animated via per-clip keyframes
 *     animation: dofus-point-<s>-<t>-bright <dur>ms linear forwards;
 *   }
 *   (same for shadow, with channels × 0.6015625)
 *
 *   @keyframes dofus-point-<s>-<t>-curve {
 *     0%   { --pt-tx: ...; --pt-ty: ...; --pt-sx: ...; --pt-sy: ...; --pt-opacity: ...; }
 *     ...
 *   }
 *   @keyframes dofus-point-<s>-<t>-bright { 0% {...}; ... }   // only if non-identity
 *   @keyframes dofus-point-<s>-<t>-shadow { 0% {...}; ... }   // only if non-identity
 *
 * The curve keyframes set @property-typed CSS variables; the static
 * `points.css` reads them via var() in the spans' transform / opacity
 * properties, so the browser interpolates the variables and the
 * spans re-render automatically each frame.
 */

/** Canonical SWF cid=4 depth-1 cxform multiplier for the relief shadow. */
const RELIEF_MUL = 0.6015625;

/** Canonical playback fps — the AS2 stage runs at 30 fps regardless of
 *  the SWF's authored fps (60). */
const PLAYBACK_FPS = 30;

interface ChannelTriplet {
  r: number;
  g: number;
  b: number;
}

/**
 * Apply Flash CXform to a base channel: `out = clamp(in * mul + add, 0, 255)`.
 * `add` is in [-256, 256] integer; `mul` in [0, 256] / 256 = [0, 1] (or higher
 * when overshooting white).
 */
function applyChannel(channel: number, mul: number, add: number): number {
  return Math.max(0, Math.min(255, Math.round(channel * mul + add)));
}

function applyCxformToBase(
  base: ChannelTriplet,
  f: PointFrame
): ChannelTriplet {
  return {
    r: applyChannel(base.r, f.rMul, f.rAdd),
    g: applyChannel(base.g, f.gMul, f.gAdd),
    b: applyChannel(base.b, f.bMul, f.bAdd),
  };
}

/** Channel-wise `× RELIEF_MUL`, kept as fractional for cxform composition. */
function darken(base: ChannelTriplet): ChannelTriplet {
  return {
    r: base.r * RELIEF_MUL,
    g: base.g * RELIEF_MUL,
    b: base.b * RELIEF_MUL,
  };
}

function rgbCss(c: ChannelTriplet): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function unpackColor(packed: number): ChannelTriplet {
  return {
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
  };
}

/** A clip's cxform is "identity" if every frame leaves the colour
 *  unchanged: rMul=gMul=bMul=1, rAdd=gAdd=bAdd=0. We test all frames
 *  since some clips animate the cxform mid-curve (damage style 1 has
 *  a white-flash fade-in over the first 17 frames). */
function isIdentityCxform(frames: PointFrame[]): boolean {
  return frames.every(
    (f) =>
      f.rMul === 1 &&
      f.gMul === 1 &&
      f.bMul === 1 &&
      f.rAdd === 0 &&
      f.gAdd === 0 &&
      f.bAdd === 0
  );
}

/** Compute a frame's percentage offset along the @keyframes timeline.
 *  Frame `i` (0-based) → `i / (N - 1) * 100`%. We round to 4 decimals
 *  to keep the CSS file deterministic across machines without sacrificing
 *  precision. */
function pct(i: number, total: number): string {
  if (total <= 1) return "0%";
  const v = (i / (total - 1)) * 100;
  return `${Number(v.toFixed(4))}%`;
}

function num(n: number, decimals = 4): string {
  return Number(n.toFixed(decimals)).toString();
}

/** Build the curve @keyframes — sets --pt-tx, --pt-ty, --pt-sx,
 *  --pt-sy, --pt-opacity per frame. The per-frame `tx, ty` are stored
 *  as bare numbers; the consumer multiplies by `1px * var(--cs)` in
 *  its transform expression. Same for `sx, sy` as scale factors. */
function buildCurveKeyframes(name: string, m: PointManifest): string {
  const lines: string[] = [`@keyframes ${name} {`];
  for (let i = 0; i < m.frames.length; i++) {
    const f = m.frames[i];
    if (!f) continue;
    const stop = pct(i, m.frames.length);
    lines.push(
      `  ${stop} { --pt-tx: ${num(f.tx, 2)}; --pt-ty: ${num(f.ty, 2)}; ` +
        `--pt-sx: ${num(f.sx, 4)}; --pt-sy: ${num(f.sy, 4)}; ` +
        `--pt-opacity: ${num(f.aMul, 4)}; }`
    );
  }
  lines.push("}");
  return lines.join("\n");
}

/** Build a colour @keyframes — sets a single CSS variable
 *  (`--bright-color` or `--shadow-color`) over the cxform curve. */
function buildColorKeyframes(
  name: string,
  variable: string,
  base: ChannelTriplet,
  frames: PointFrame[]
): string {
  const lines: string[] = [`@keyframes ${name} {`];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f) continue;
    const stop = pct(i, frames.length);
    const c = applyCxformToBase(base, f);
    lines.push(`  ${stop} { ${variable}: ${rgbCss(c)}; }`);
  }
  lines.push("}");
  return lines.join("\n");
}

/** Compose the per-clip CSS block: animation wiring + curve keyframe +
 *  colour keyframes (or static colour rules when cxform is identity). */
function buildClipBlock(m: PointManifest): string {
  const tag = `${m.style}-${m.type}`;
  const sel = `.dofus-point--${tag}`;
  const curveName = `dofus-point-${tag}-curve`;
  const brightName = `dofus-point-${tag}-bright`;
  const shadowName = `dofus-point-${tag}-shadow`;
  const durationMs = (m.frames.length / PLAYBACK_FPS) * 1000;
  const dur = `${Number(durationMs.toFixed(2))}ms`;

  const out: string[] = [];
  out.push(`/* ── style=${m.style} type=${m.type} (${m.frames.length} frames @ ${PLAYBACK_FPS}fps = ${dur}, color 0x${m.color.toString(16).padStart(6, "0")}) ── */`);

  // The curve animation runs on the wrapper, driving the @property
  // variables that the inner spans read via var().
  out.push(`${sel} {`);
  out.push(`  animation: ${curveName} ${dur} linear forwards;`);
  out.push(`}`);

  const base = unpackColor(m.color);
  const baseDark = darken(base);

  if (isIdentityCxform(m.frames)) {
    // Static colours — no per-frame interpolation needed. The bright
    // variable holds the canonical hue; the shadow variable holds
    // it × 0.6015625, rounded.
    const dark: ChannelTriplet = {
      r: Math.round(baseDark.r),
      g: Math.round(baseDark.g),
      b: Math.round(baseDark.b),
    };
    out.push(`${sel} .dofus-point__bright { --bright-color: ${rgbCss(base)}; }`);
    out.push(`${sel} .dofus-point__shadow { --shadow-color: ${rgbCss(dark)}; }`);
  } else {
    // Animated colours. Each span runs a parallel keyframe that
    // sets ITS own colour variable. Both run for the same duration
    // as the curve so they end together.
    out.push(`${sel} .dofus-point__bright {`);
    out.push(`  animation: ${brightName} ${dur} linear forwards;`);
    out.push(`}`);
    out.push(`${sel} .dofus-point__shadow {`);
    out.push(`  animation: ${shadowName} ${dur} linear forwards;`);
    out.push(`}`);
  }

  out.push("");
  out.push(buildCurveKeyframes(curveName, m));

  if (!isIdentityCxform(m.frames)) {
    out.push("");
    out.push(buildColorKeyframes(brightName, "--bright-color", base, m.frames));
    out.push("");
    out.push(buildColorKeyframes(shadowName, "--shadow-color", baseDark, m.frames));
  }

  return out.join("\n");
}

export interface PointsCssCompileResult {
  outputPath: string;
  clips: number;
  bytes: number;
  durationMs: number;
}

/** Drive the full compile across both styles × all 5 types. */
export async function compilePointsCss(): Promise<PointsCssCompileResult> {
  const start = performance.now();
  const publicDir = resolve(
    paths.repoRoot,
    "apps/electrobun/public/assets/dofassets/points"
  );
  const outputPath = resolve(
    paths.repoRoot,
    "apps/electrobun/src/hud/fight/points.generated.css"
  );

  const blocks: string[] = [];
  blocks.push(`/*
 * GENERATED — do not edit.
 * Source: apps/electrobun/public/assets/dofassets/points/<style>/<type>.json
 * Producer: tools/asset-pipeline/src/stages/compile/points-css.ts
 *
 * Run \`bun run pipeline points\` to regenerate. Each (style, type)
 * pair compiles into one curve @keyframes (animating the
 * @property-typed CSS variables --pt-tx / --pt-ty / --pt-sx /
 * --pt-sy / --pt-opacity that the spans in points.css read) plus
 * either a pair of cxform colour @keyframes (when the SWF carries
 * a non-identity cxform such as the damage white-flash) or a pair
 * of static --bright-color / --shadow-color rules (identity cxform —
 * AP, MP, etc. ship without any colour animation).
 */
`);

  let clipCount = 0;
  for (const { style, type } of POINT_PAIRS) {
    const jsonPath = resolve(publicDir, String(style), `${type}.json`);
    let manifest: PointManifest;
    try {
      manifest = JSON.parse(await readFile(jsonPath, "utf-8"));
    } catch (err) {
      logger.warn({ err, style, type }, "skip points-css clip — JSON missing");
      continue;
    }
    blocks.push(buildClipBlock(manifest));
    blocks.push("");
    clipCount++;
  }

  const css = blocks.join("\n");
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, css);

  return {
    outputPath,
    clips: clipCount,
    bytes: css.length,
    durationMs: Math.round(performance.now() - start),
  };
}
