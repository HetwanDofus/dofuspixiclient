import { load } from "cheerio";
import type { Element } from "domhandler";

import { parseSvg } from "./svg-parser.ts";
import type {
  AffineTransform,
  ParsedAccessorySlot,
  ParsedClipRect,
  ParsedFrame,
  ParsedFrameUse,
  ParsedSvg,
} from "./types.ts";
import { IDENTITY_TRANSFORM } from "./types.ts";

/**
 * Parsed output of a standalone per-frame SVG — one of the files the PHP
 * sprite extractor writes at `extract/sprites/svg/<id>/<anim>_<n>.svg`.
 *
 * Each frame SVG has its OWN local id namespace (`object-0`, `object-1`,
 * …), so different frames can reuse the same id for different shapes. To
 * merge N frames into one animation we rewrite every id with a unique
 * per-frame prefix before parsing; the resulting defs/patterns/uses are
 * then safe to union across frames.
 */
export interface ParsedFrameSvg {
  width: number;
  height: number;
  /** The single frame — its `<use>`s are the root-level refs after parsing. */
  frame: ParsedFrame;
  /** Ready-to-merge subset of the full ParsedSvg. */
  svg: ParsedSvg;
  /** Prefix applied to every id in this frame. */
  prefix: string;
}

export interface ParseFrameSvgOptions {
  /** Unique prefix (e.g. `a0f7_`). Every `id="…"` and `href="#…"` gets rewritten. */
  prefix: string;
  /**
   * Frame index within its animation. Stamped into the synthetic clipRect
   * (`x = frameIndex`) so the downstream atlas↔SVG-frame rect-matcher can
   * distinguish frames that share identical canvas dimensions. Defaults to 0.
   */
  frameIndex?: number;
}

/**
 * Rewrite every id reference in an SVG with a given prefix. Covers:
 *
 *   - `id="foo"`                → `id="${prefix}foo"`
 *   - `href="#foo"`             → `href="#${prefix}foo"`
 *   - `xlink:href="#foo"`       → `xlink:href="#${prefix}foo"`
 *   - `url(#foo)` in any attr   → `url(#${prefix}foo)`
 *
 * Cheap regex rewrite; the parse step below relies on cheerio so the
 * rewrite only has to be textually correct.
 */
export function namespaceSvgIds(svg: string, prefix: string): string {
  if (!prefix) return svg;
  return svg
    .replace(/\bid="([^"]+)"/g, (_m, id) => `id="${prefix}${id}"`)
    .replace(
      /\b(xlink:href|href)="#([^"]+)"/g,
      (_m, attr, id) => `${attr}="#${prefix}${id}"`
    )
    .replace(/url\(#([^)]+)\)/g, (_m, id) => `url(#${prefix}${id})`);
}

/**
 * Parse a single standalone per-frame SVG into a ParsedSvg with exactly one
 * synthetic ParsedFrame — enough for the downstream compile pipeline to
 * treat it as one drawing state of an animation.
 */
export function parseFrameSvg(
  svgContent: string,
  opts: ParseFrameSvgOptions
): ParsedFrameSvg {
  const namespaced = namespaceSvgIds(svgContent, opts.prefix);
  const parsed = parseSvg(namespaced);
  const frame = buildSyntheticFrame(namespaced, opts.prefix, opts.frameIndex ?? 0);
  return {
    width: parsed.width,
    height: parsed.height,
    frame,
    svg: { ...parsed, frames: [frame] },
    prefix: opts.prefix,
  };
}

/**
 * Build one ParsedFrame from a standalone SVG that has no `<g clip-path>`
 * wrapper — which is the shape the Dofus 1.29 sprite extractor writes.
 *
 * Content layout assumed:
 *
 *   <svg width=… height=…>
 *     <g transform=matrix(…)>        ← root group; its transform is the
 *                                       animation-pivot translation
 *       <use xlink:href="#${prefix}object-0" transform=…/>
 *       …
 *     </g>
 *     <defs>…</defs>
 *   </svg>
 *
 * The clipRect is the SVG canvas `(0, 0, width, height)`; the root group's
 * transform becomes the frame's `offsetTransform`.
 */
function buildSyntheticFrame(
  svgContent: string,
  prefix: string,
  frameIndex: number
): ParsedFrame {
  const $ = load(svgContent, { xml: true });
  const $svg = $("svg");

  const width = parseFloat($svg.attr("width") ?? "0") || 0;
  const height = parseFloat($svg.attr("height") ?? "0") || 0;

  const $rootGroup = $svg.children("g").not("[clip-path]").first();
  const offsetTransform = parseTransformAttr($rootGroup.attr("transform"));

  const uses: ParsedFrameUse[] = [];
  const accessorySlots: ParsedAccessorySlot[] = [];

  $rootGroup.children().each((_idx, el) => {
    const tag = (el as Element).tagName;
    const $el = $(el as Element);
    if (tag === "use") {
      const href = ($el.attr("xlink:href") ?? $el.attr("href") ?? "").replace(
        "#",
        ""
      );
      const useTransform = composeUseTransform(
        $el.attr("transform"),
        $el.attr("x"),
        $el.attr("y")
      );
      uses.push({ href, transform: useTransform });
    } else if (tag === "rect" && $el.attr("data-acc-slot")) {
      // Accessory placeholders are injected by the svg-spritesheet tool for
      // character atlases. Per-frame SVGs don't carry them today — the
      // sprite extractor doesn't inject placeholders — so we keep the
      // parse structurally compatible but expect empty lists here. If a
      // future extractor pass does inject them, the same regex as in the
      // character atlas parser handles them.
      const slotId = parseInt($el.attr("data-acc-slot") ?? "0", 10);
      const tx = parseFloat($el.attr("data-tx") ?? "0");
      const ty = parseFloat($el.attr("data-ty") ?? "0");
      const depth = parseFloat($el.attr("data-depth") ?? "0");
      const matrixStr = $el.attr("data-matrix");
      let matrix: AffineTransform | null = null;
      if (matrixStr) {
        const parts = matrixStr.split(",").map(Number);
        matrix = [
          parts[0] ?? 1,
          parts[1] ?? 0,
          parts[2] ?? 0,
          parts[3] ?? 1,
          parts[4] ?? 0,
          parts[5] ?? 0,
        ];
      }
      accessorySlots.push({
        slotId,
        tx,
        ty,
        matrix,
        depth,
        insertAfterPart: uses.length,
      });
    }
  });

  const clipRect: ParsedClipRect = {
    id: `${prefix}__frame__`,
    x: frameIndex,
    y: 0,
    width,
    height,
  };

  return {
    clipPathId: clipRect.id,
    clipRect,
    offsetTransform,
    uses,
    accessorySlots,
  };
}

function parseTransformAttr(attr: string | undefined): AffineTransform {
  if (!attr) return [...IDENTITY_TRANSFORM];
  const m = attr.match(/matrix\(([^)]+)\)/);
  if (m) {
    const parts = m[1]!.split(/[,\s]+/).map(Number);
    return [
      parts[0] ?? 1,
      parts[1] ?? 0,
      parts[2] ?? 0,
      parts[3] ?? 1,
      parts[4] ?? 0,
      parts[5] ?? 0,
    ];
  }
  const t = attr.match(/translate\(([^)]+)\)/);
  if (t) {
    const parts = t[1]!.split(/[,\s]+/).map(Number);
    return [1, 0, 0, 1, parts[0] ?? 0, parts[1] ?? 0];
  }
  return [...IDENTITY_TRANSFORM];
}

function composeUseTransform(
  transformAttr: string | undefined,
  xAttr: string | undefined,
  yAttr: string | undefined
): AffineTransform {
  const base = parseTransformAttr(transformAttr);
  const x = xAttr !== undefined ? parseFloat(xAttr) : 0;
  const y = yAttr !== undefined ? parseFloat(yAttr) : 0;
  if (x === 0 && y === 0) return base;
  return [base[0], base[1], base[2], base[3], base[4] + x, base[5] + y];
}
