import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { load, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { compileStatic } from "@dofus/dofasset-format/pipeline";

import { logger } from "../../logger.ts";
import {
  distDofassetPath,
  distLangsBundlePath,
  extractCachePath,
} from "../../paths.ts";

/**
 * Index into the per-spell color arrays — mirrors
 * `SpellFullIcon.getColorIndexForColorsArrays()` for pack "classic" (2).
 * That's the element-colored pack (fire spells get red backdrops, water
 * blue, etc.) which reads closest to the original Dofus 1.29 HUD.
 */
const PACK_INDEX = 2;

/**
 * A composed spell-icon SVG is glued from three clip MovieClips the Flash
 * client tinted independently at runtime:
 *
 *   - `_spellBackground` — `back/<i.b>.swf` (filled backdrop circle)
 *   - `_spellFrame`      — also `back/<i.b>.swf` (inner ring / frame)
 *   - `_spellPrint`      — `up/<i.up>.swf`      (foreground glyph)
 *
 * AS2 `applyBackgroundColors` / `applyUpColors` call
 * `new Color(_spellX).setRGB(spell.info.(bc|fc|pc)[pack])` on each — we
 * pre-bake those tints into the SVG so a single dofasset per spell id
 * fully represents its icon with zero runtime composition.
 */

export interface SpellIconCompileEntry {
  spellId: number;
  dofassetPath: string;
  outputBytes: number;
}

export interface SpellIconCompileOptions {
  filterId?: number;
  locale?: string;
}

export interface SpellIconCompileResult {
  outputDir: string;
  entries: SpellIconCompileEntry[];
  skipped: number;
  failed: number;
  durationMs: number;
}

interface LangSpellInfo {
  up?: number;
  b?: number;
  pc?: number[];
  bc?: number[];
  fc?: number[];
}
interface LangSpell {
  n: string;
  i?: LangSpellInfo;
}
interface LangBundle {
  data: { S: Record<string, LangSpell> };
}

/**
 * Compose + compile spell-icon dofassets keyed by spell_id. The client only
 * ever needs `/assets/dofassets/spells/icons/<spell_id>.dofasset` — one
 * fetch, one Vello render, no composition or per-slot tinting at run time.
 */
export async function compileSpellIcons(
  opts: SpellIconCompileOptions = {}
): Promise<SpellIconCompileResult> {
  const locale = opts.locale ?? "fr";
  const start = performance.now();

  const langs = await loadSpellsBundle(locale);
  const backCache = await buildBackIndex();
  const upCache = await buildUpIndex();

  const outputDir = distDofassetPath("spells/icons");
  await mkdir(outputDir, { recursive: true });

  const entries: SpellIconCompileEntry[] = [];
  let skipped = 0;
  let failed = 0;

  for (const [idStr, spell] of Object.entries(langs.data.S)) {
    const spellId = Number(idStr);
    if (!Number.isFinite(spellId)) continue;
    if (opts.filterId !== undefined && spellId !== opts.filterId) {
      skipped++;
      continue;
    }

    const info = spell.i;
    const upId = typeof info?.up === "number" ? info.up : undefined;
    const backId = typeof info?.b === "number" ? info.b : undefined;
    if (upId === undefined || backId === undefined) {
      skipped++;
      continue;
    }

    const upSvg = upCache.get(upId);
    const backSvg = backCache.get(backId);
    if (!upSvg || !backSvg) {
      skipped++;
      continue;
    }

    const tints = pickPackColors(info);
    try {
      const composed = composeIconSvg({
        backSvg,
        upSvg,
        tints,
      });
      const compiled = compileStatic(composed, { assetId: spellId });
      const dofassetPath = resolve(outputDir, `${spellId}.dofasset`);
      await mkdir(dirname(dofassetPath), { recursive: true });
      await writeFile(dofassetPath, compiled.bytes);
      entries.push({
        spellId,
        dofassetPath,
        outputBytes: compiled.bytes.byteLength,
      });
    } catch (err) {
      failed++;
      logger.warn(
        { spellId, err: (err as Error).message },
        "compile:spells.icons failed"
      );
    }
  }

  const durationMs = Math.round(performance.now() - start);
  logger.info(
    {
      composed: entries.length,
      skipped,
      failed,
      durationMs,
      locale,
    },
    "compile:spells.icons done"
  );

  return { outputDir, entries, skipped, failed, durationMs };
}

interface PackColors {
  /** `spell.info.pc[pack]` — tints `_spellPrint` (glyph). */
  pc: string | null;
  /** `spell.info.bc[pack]` — tints `_spellBackground` (filled circle). */
  bc: string | null;
  /** `spell.info.fc[pack]` — tints `_spellFrame` (ring). */
  fc: string | null;
}

function pickPackColors(info: LangSpellInfo | undefined): PackColors {
  const read = (arr: number[] | undefined): string | null => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const v = arr[PACK_INDEX];
    if (typeof v !== "number" || v < 0) return null;
    return `#${(v >>> 0).toString(16).padStart(6, "0")}`;
  };
  // Straight index into the classic pack — AS2 did the same (no fallback,
  // just `Color.setRGB(pc[pack])`). White (0xffffff) is NOT a sentinel for
  // "skip tint": the classic pack intentionally paints the glyph/frame white
  // over a colored `bc` disc (fire red, water blue, etc.), which is the
  // whole point of that pack. We apply exactly what AS2 applied.
  return {
    pc: read(info?.pc),
    bc: read(info?.bc),
    fc: read(info?.fc),
  };
}

/** Merge the two source SVGs into one tinted SVG ready for compileStatic. */
function composeIconSvg(args: {
  backSvg: string;
  upSvg: string;
  tints: PackColors;
}): string {
  const backDoc = parseSvg(args.backSvg);
  const upDoc = parseSvg(args.upSvg);

  // Prefix ids separately so the two source trees don't collide once merged.
  namespaceIds(backDoc.$, "bg_");
  namespaceIds(upDoc.$, "up_");

  // Tint each named clip's reachable defs in place.
  applyClipTint(backDoc.$, "bg__spellBackground", args.tints.bc);
  applyClipTint(backDoc.$, "bg__spellFrame", args.tints.fc);
  applyClipTint(upDoc.$, "up__spellPrint", args.tints.pc);

  const viewBox = outerViewBox(backDoc, upDoc);
  // compileStatic's buildStaticFrame reads `<use>` children from a SINGLE
  // root `<g>` (the first one without a clip-path). If we emit two top-
  // level groups — one for the back layer and one for the up layer — the
  // up layer silently disappears. Merge the children of both layers into
  // one root `<g>` to stay compatible.
  const rootChildren = [
    ...innerOfFirstGroup(backDoc.$),
    ...innerOfFirstGroup(upDoc.$),
  ].join("");
  const backDefs =
    backDoc.$("svg > defs").html() ??
    backDoc.$("defs").first().html() ??
    "";
  const upDefs =
    upDoc.$("svg > defs").html() ?? upDoc.$("defs").first().html() ?? "";

  // viewBox origin → (0, 0) so `compileStatic`'s `clip_rect` doesn't
  // trigger Vello's negative-origin translate shift. Content's top-left
  // is at SVG `(0.05, 0.05)` (the back-fill path starts there), so a
  // straight tight-clip leaves a 0.05-unit transparent stripe on
  // top/left. We nudge content by `(-0.05, -0.05)` via the root `<g>`'s
  // `offsetTransform` (consumed by `deduplicator.ts:626`) so the
  // drawn back fill lands exactly at canvas pixel `(0, 0)` — icon sits
  // flush with the slot's inner beveled edge.
  return (
    `<?xml version="1.0"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${viewBox.w}" height="${viewBox.h}" ` +
    `viewBox="0 0 ${viewBox.w} ${viewBox.h}">` +
    `<g transform="translate(-0.05 -0.05)">${rootChildren}</g>` +
    `<defs>${backDefs}${upDefs}</defs>` +
    `</svg>`
  );
}

/**
 * Serialize every direct child of the first top-level `<g>`. Both source
 * SVGs apply an identity-matrix wrapper group; the children are the `<use>`
 * elements that actually reference defs. We unwrap so the merged output can
 * sit under one shared root `<g>`.
 */
function innerOfFirstGroup($: CheerioAPI): string[] {
  const root = $("svg").children("g").first();
  return root
    .children()
    .toArray()
    .map((el) => $.xml(el));
}

interface ParsedSvgDoc {
  $: CheerioAPI;
  viewBox: { x: number; y: number; w: number; h: number };
}

function parseSvg(svgText: string): ParsedSvgDoc {
  const $ = load(svgText, { xml: true });
  const $svg = $("svg").first();
  const vb = ($svg.attr("viewBox") ?? "0 0 0 0").trim().split(/\s+/).map(Number);
  const viewBox = {
    x: vb[0] ?? 0,
    y: vb[1] ?? 0,
    w: vb[2] ?? parseFloat($svg.attr("width") ?? "0") ?? 0,
    h: vb[3] ?? parseFloat($svg.attr("height") ?? "0") ?? 0,
  };
  return { $, viewBox };
}

/**
 * Prefix every id (and every `#<id>` reference — both `href` attributes and
 * `url(#id)` inside any attribute) so two SVGs can live in one document
 * without colliding on shared names like `object-0`.
 */
function namespaceIds($: CheerioAPI, prefix: string): void {
  // Protect reserved clip ids — those stay identifiable after the prefix.
  $("[id]").each((_: number, el: Element) => {
    const id = $(el).attr("id");
    if (!id) return;
    $(el).attr("id", `${prefix}${id}`);
  });
  // Rewrite xlink:href and href
  $("[xlink\\:href]").each((_: number, el: Element) => {
    const href = $(el).attr("xlink:href");
    if (href && href.startsWith("#")) {
      $(el).attr("xlink:href", `#${prefix}${href.slice(1)}`);
    }
  });
  $("[href]").each((_: number, el: Element) => {
    const href = $(el).attr("href");
    if (href && href.startsWith("#")) {
      $(el).attr("href", `#${prefix}${href.slice(1)}`);
    }
  });
  // Rewrite url(#foo) references inside attributes (fill, clip-path, mask, …).
  $("*").each((_: number, node: AnyNode) => {
    if (node.type !== "tag") return;
    const el = node as Element;
    for (const [name, value] of Object.entries(el.attribs)) {
      if (typeof value !== "string") continue;
      if (!value.includes("url(#")) continue;
      $(el).attr(
        name,
        value.replace(/url\(#([^)]+)\)/g, (_m, ref) => `url(#${prefix}${ref})`)
      );
    }
  });
}

/**
 * Walk every path/fill/stroke reachable from the named clip (via
 * `<use xlink:href="#id">` chains) and rewrite `#ffffff` — plus any other
 * fill/stroke color — to the pack tint. Leaves `fill="none"` /
 * `stroke="none"` alone; those encode "do not paint".
 */
function applyClipTint(
  $: CheerioAPI,
  clipId: string,
  color: string | null
): void {
  if (!color) return;
  const visited = new Set<string>();
  const stack: string[] = [clipId];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const $node = $(`#${cssEscape(id)}`);
    if ($node.length === 0) continue;
    // Recolor paths in this subtree.
    $node.find("path").each((_: number, el: Element) => {
      recolorEl($, el, color);
    });
    // Follow every <use> in the subtree and in the defs the clip references.
    $node.find("use").each((_: number, el: Element) => {
      const href = $(el).attr("xlink:href") ?? $(el).attr("href");
      if (href && href.startsWith("#")) stack.push(href.slice(1));
    });
    // The node itself may be a <use>.
    if ($node.is("use")) {
      const href = $node.attr("xlink:href") ?? $node.attr("href");
      if (href && href.startsWith("#")) stack.push(href.slice(1));
    }
  }
}

function recolorEl($: CheerioAPI, el: Element, color: string): void {
  const $el = $(el);
  const fill = $el.attr("fill");
  if (fill && fill !== "none") $el.attr("fill", color);
  const stroke = $el.attr("stroke");
  if (stroke && stroke !== "none") $el.attr("stroke", color);
}

function cssEscape(id: string): string {
  // Cheerio selectors use CSS syntax — prefix-ids with a leading underscore
  // (as in `_spellBackground`) are legal but the `_` doesn't need escaping.
  return id.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

function outerViewBox(
  a: ParsedSvgDoc,
  b: ParsedSvgDoc
): { x: number; y: number; w: number; h: number } {
  // The back layer is the larger one (44×44) and logically wraps the up
  // layer — keep its viewBox. Both source SWFs position content against
  // the same Flash stage origin, so no per-layer translate is needed.
  return a.viewBox.w > b.viewBox.w ? a.viewBox : b.viewBox;
}

async function loadSpellsBundle(locale: string): Promise<LangBundle> {
  const path = distLangsBundlePath(locale, "spells");
  const text = await readFile(path, "utf-8");
  return JSON.parse(text) as LangBundle;
}

async function buildBackIndex(): Promise<Map<number, string>> {
  const dir = extractCachePath("spells.icons.back");
  const out = new Map<number, string>();
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of files) {
    if (!name.endsWith(".svg")) continue;
    const id = Number(name.slice(0, -4));
    if (!Number.isFinite(id)) continue;
    out.set(id, await readFile(resolve(dir, name), "utf-8"));
  }
  return out;
}

async function buildUpIndex(): Promise<Map<number, string>> {
  const dir = extractCachePath("spells.icons");
  const out = new Map<number, string>();
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of files) {
    if (!name.endsWith(".svg")) continue;
    const id = Number(name.slice(0, -4));
    if (!Number.isFinite(id)) continue;
    out.set(id, await readFile(resolve(dir, name), "utf-8"));
  }
  return out;
}

