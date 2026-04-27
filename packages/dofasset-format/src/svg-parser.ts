import { load, type CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { parsePath } from "./path-parser.js";
import type {
  ParsedSvg,
  ParsedNode,
  ParsedPath,
  ParsedPattern,
  ParsedGradient,
  ParsedGradientStop,
  ParsedClipRect,
  ParsedFrame,
  ParsedFrameUse,
  ParsedAccessorySlot,
  AffineTransform,
  FillRule,
} from "./types.js";
import { IDENTITY_TRANSFORM as ID_TRANSFORM } from "./types.js";

/** Inherited SVG presentation attributes that flow from parent groups to children. */
interface InheritedStyles {
  fill: string | null;
  fillOpacity: number;
  fillRule: FillRule;
  stroke: string | null;
  strokeOpacity: number;
  strokeWidth: string | null;
  strokeLinecap: string;
  strokeLinejoin: string;
  /** `vector-effect` attribute (e.g. "non-scaling-stroke"). Inherited per SVG spec. */
  vectorEffect: string | null;
  /** Accumulated element-level opacity that multiplies into fill/stroke opacity. */
  opacity: number;
}

const DEFAULT_INHERITED: InheritedStyles = {
  fill: null,
  fillOpacity: 1,
  fillRule: 0,
  stroke: null,
  strokeOpacity: 1,
  strokeWidth: null,
  strokeLinecap: "butt",
  strokeLinejoin: "miter",
  vectorEffect: null,
  opacity: 1,
};

/** Extract inherited style attributes from a group element, merging with parent styles. */
function extractGroupStyles($: CheerioAPI, el: Element, parent: InheritedStyles): InheritedStyles {
  const $el = $(el);
  // SVG `opacity` on a group multiplies into all children's fill/stroke opacity.
  const elemOpacity = $el.attr("opacity") !== undefined ? parseFloat($el.attr("opacity")!) : 1;
  const opacity = parent.opacity * elemOpacity;
  return {
    fill: $el.attr("fill") ?? parent.fill,
    fillOpacity: $el.attr("fill-opacity") !== undefined ? parseFloat($el.attr("fill-opacity")!) : parent.fillOpacity,
    fillRule: $el.attr("fill-rule") === "evenodd" ? 1 : ($el.attr("fill-rule") !== undefined ? 0 : parent.fillRule),
    stroke: $el.attr("stroke") ?? parent.stroke,
    strokeOpacity: $el.attr("stroke-opacity") !== undefined ? parseFloat($el.attr("stroke-opacity")!) : parent.strokeOpacity,
    strokeWidth: $el.attr("stroke-width") ?? parent.strokeWidth,
    strokeLinecap: $el.attr("stroke-linecap") ?? parent.strokeLinecap,
    strokeLinejoin: $el.attr("stroke-linejoin") ?? parent.strokeLinejoin,
    vectorEffect: $el.attr("vector-effect") ?? parent.vectorEffect,
    opacity,
  };
}

/**
 * Parse a transform attribute string into an AffineTransform.
 * Handles: matrix(a,b,c,d,tx,ty), translate(tx,ty), rotate(deg,cx,cy), scale(sx,sy)
 */
export function parseTransform(attr: string | undefined): AffineTransform {
  if (!attr) return [...ID_TRANSFORM] as AffineTransform;

  const result: AffineTransform = [1, 0, 0, 1, 0, 0];

  // Match all transform functions
  const re = /(matrix|translate|rotate|scale)\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(attr)) !== null) {
    const fn = match[1]!;
    const args = match[2]!.split(/[\s,]+/).map((s) => Math.fround(Number(s)));

    let m: AffineTransform;
    switch (fn) {
      case "matrix":
        m = [args[0] ?? 1, args[1] ?? 0, args[2] ?? 0, args[3] ?? 1, args[4] ?? 0, args[5] ?? 0];
        break;
      case "translate":
        m = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "rotate": {
        const deg = (args[0] ?? 0) * Math.PI / 180;
        const cos = Math.cos(deg);
        const sin = Math.sin(deg);
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        // rotate around (cx,cy): translate(cx,cy) * rotate * translate(-cx,-cy)
        if (cx !== 0 || cy !== 0) {
          m = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        } else {
          m = [cos, sin, -sin, cos, 0, 0];
        }
        break;
      }
      case "scale": {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        m = [sx, 0, 0, sy, 0, 0];
        break;
      }
      default:
        m = [1, 0, 0, 1, 0, 0];
    }

    // Compose: result = result * m
    const [a1, b1, c1, d1, tx1, ty1] = result;
    const [a2, b2, c2, d2, tx2, ty2] = m;
    // Use Math.fround to match usvg's f32 transform composition precision
    const f = Math.fround;
    result[0] = f(f(a1 * a2) + f(c1 * b2));
    result[1] = f(f(b1 * a2) + f(d1 * b2));
    result[2] = f(f(a1 * c2) + f(c1 * d2));
    result[3] = f(f(b1 * c2) + f(d1 * d2));
    result[4] = f(f(f(a1 * tx2) + f(c1 * ty2)) + tx1);
    result[5] = f(f(f(b1 * tx2) + f(d1 * ty2)) + ty1);
  }

  return result;
}

/**
 * Parse a `<path>` element into a ParsedPath, merging with inherited styles.
 */
function parseSvgPath($: CheerioAPI, el: Element, inherited: InheritedStyles = DEFAULT_INHERITED): ParsedPath {
  const $el = $(el);
  const d = $el.attr("d") ?? "";
  // Element attributes override inherited ones
  const fill = $el.attr("fill") ?? inherited.fill;
  const fillOpacityStr = $el.attr("fill-opacity");
  const baseFillOpacity = fillOpacityStr !== undefined ? parseFloat(fillOpacityStr) : inherited.fillOpacity;
  const fillRuleStr = $el.attr("fill-rule");
  const fillRule: FillRule = fillRuleStr === "evenodd" ? 1 : (fillRuleStr !== undefined ? 0 : inherited.fillRule);
  const stroke = $el.attr("stroke") ?? inherited.stroke;
  const strokeOpacityStr = $el.attr("stroke-opacity");
  const baseStrokeOpacity = strokeOpacityStr !== undefined ? parseFloat(strokeOpacityStr) : inherited.strokeOpacity;
  const strokeWidth = $el.attr("stroke-width") ?? inherited.strokeWidth;
  const strokeLinecap = $el.attr("stroke-linecap") ?? inherited.strokeLinecap;
  const strokeLinejoin = $el.attr("stroke-linejoin") ?? inherited.strokeLinejoin;
  const vectorEffect = $el.attr("vector-effect") ?? inherited.vectorEffect;
  const transform = parseTransform($el.attr("transform"));

  // SVG `opacity` on an element multiplies into both fill and stroke opacity.
  // Also accumulate inherited group opacity.
  const elemOpacity = $el.attr("opacity") !== undefined ? parseFloat($el.attr("opacity")!) : 1;
  const totalOpacity = inherited.opacity * elemOpacity;
  const fillOpacity = baseFillOpacity * totalOpacity;
  const strokeOpacity = baseStrokeOpacity * totalOpacity;

  return {
    segments: parsePath(d),
    fill,
    fillOpacity,
    fillRule,
    stroke,
    strokeOpacity,
    strokeWidth,
    strokeLinecap,
    strokeLinejoin,
    vectorEffect,
    transform,
  };
}

/**
 * Parse a `<g>` element's children into ParsedNodes, with inherited style context.
 */
function parseGroupChildren($: CheerioAPI, el: Element, inherited: InheritedStyles = DEFAULT_INHERITED): ParsedNode[] {
  const children: ParsedNode[] = [];
  $(el).children().each((_, child) => {
    const tagName = (child as Element).tagName;
    if (tagName === "path") {
      children.push({ type: "path", data: parseSvgPath($, child as Element, inherited) });
    } else if (tagName === "g") {
      const $child = $(child);
      const id = $child.attr("id") ?? "";
      const transform = parseTransform($child.attr("transform"));
      const childInherited = extractGroupStyles($, child as Element, inherited);
      const groupChildren = parseGroupChildren($, child as Element, childInherited);
      children.push({
        type: "group",
        data: { id, children: groupChildren, transform },
      });
    } else if (tagName === "use") {
      const $child = $(child);
      const href = $child.attr("xlink:href") ?? $child.attr("href") ?? "";
      const hrefId = href.replace("#", "");
      const transform = parseTransform($child.attr("transform"));
      children.push({ type: "use", data: { href: hrefId, transform } });
    }
  });
  return children;
}

/**
 * Parse a clipPath's path `d` attribute to extract the clip rectangle.
 */
function parseClipRect(d: string): { x: number; y: number; width: number; height: number } {
  // Clip paths in these SVGs are always simple rects: "M1 1h23v47H1z"
  const segments = parsePath(d);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of segments) {
    for (let i = 0; i < seg.coords.length; i += 2) {
      const x = seg.coords[i]!;
      const y = seg.coords[i + 1]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Parse a complete atlas SVG file into structured data.
 */
export function parseSvg(svgContent: string): ParsedSvg {
  const $ = load(svgContent, { xml: true });
  const $svg = $("svg");

  const width = parseFloat($svg.attr("width") ?? "0");
  const height = parseFloat($svg.attr("height") ?? "0");

  const definitions = new Map<string, ParsedNode>();
  const clipPaths = new Map<string, ParsedClipRect>();
  const patterns: ParsedPattern[] = [];
  const gradients: ParsedGradient[] = [];
  const frames: ParsedFrame[] = [];

  // Parse <defs>
  $("defs").children().each((_, el) => {
    const tagName = (el as Element).tagName;
    const $el = $(el);
    const id = $el.attr("id") ?? "";

    if (tagName === "path" && id) {
      definitions.set(id, { type: "path", data: parseSvgPath($, el as Element) });
    } else if (tagName === "g" && id) {
      const transform = parseTransform($el.attr("transform"));
      const groupInherited = extractGroupStyles($, el as Element, DEFAULT_INHERITED);
      const children = parseGroupChildren($, el as Element, groupInherited);
      definitions.set(id, {
        type: "group",
        data: { id, children, transform },
      });
    } else if (tagName === "use" && id) {
      const href = ($el.attr("xlink:href") ?? $el.attr("href") ?? "").replace("#", "");
      const transform = parseTransform($el.attr("transform"));
      definitions.set(id, { type: "use", data: { href, transform } });
    } else if (tagName === "clipPath" && id) {
      const $rect = $el.find("rect");
      if ($rect.length > 0) {
        // <clipPath><rect x y width height/></clipPath>
        clipPaths.set(id, {
          id,
          x: parseFloat($rect.attr("x") ?? "0"),
          y: parseFloat($rect.attr("y") ?? "0"),
          width: parseFloat($rect.attr("width") ?? "0"),
          height: parseFloat($rect.attr("height") ?? "0"),
        });
      } else {
        // <clipPath><path d="M1 1h23v47H1z"/></clipPath>
        const pathD = $el.find("path").attr("d") ?? "";
        const rect = parseClipRect(pathD);
        clipPaths.set(id, { id, ...rect });
      }
    } else if (tagName === "pattern" && id) {
      // Flash's exporter dedups identical bitmaps by emitting the data URL
      // once on an `<image id="image-...">` inside the first pattern that
      // uses it, then every subsequent pattern wraps a bare
      // `<use xlink:href="#image-..."/>` instead of repeating the ~30 KB
      // base64 blob. The direct `<image>` lookup covers the first form; the
      // `<use>` resolution covers the rest. Without the fallback, the
      // pattern's imageDataUri would be empty and extractImages would crash
      // in parsePngDimensions on a zero-byte buffer.
      let imageHref = "";
      const $image = $el.find("image").first();
      if ($image.length > 0) {
        imageHref = $image.attr("xlink:href") ?? $image.attr("href") ?? "";
      }
      if (!imageHref) {
        const $use = $el.find("use").first();
        const rawHref = $use.attr("xlink:href") ?? $use.attr("href") ?? "";
        const refId = rawHref.startsWith("#") ? rawHref.slice(1) : "";
        if (refId) {
          const $ref = $(`#${refId}`).first();
          if ($ref.length > 0 && (($ref[0] as Element).tagName === "image")) {
            imageHref = $ref.attr("xlink:href") ?? $ref.attr("href") ?? "";
          }
        }
      }
      const patternTransform = parseTransform($el.attr("patternTransform"));
      const patWidth = parseFloat($el.attr("width") ?? "0");
      const patHeight = parseFloat($el.attr("height") ?? "0");
      patterns.push({
        id,
        imageDataUri: imageHref,
        patternTransform,
        width: patWidth,
        height: patHeight,
      });
    } else if ((tagName === "radialGradient" || tagName === "linearGradient") && id) {
      const stops: ParsedGradientStop[] = [];
      $el.find("stop").each((_, stopEl) => {
        const $stop = $(stopEl);
        stops.push({
          offset: parseFloat($stop.attr("offset") ?? "0"),
          color: $stop.attr("stop-color") ?? "#000",
          opacity: parseFloat($stop.attr("stop-opacity") ?? "1"),
        });
      });
      const gt = parseTransform($el.attr("gradientTransform"));

      if (tagName === "linearGradient") {
        // Store raw x1/y1/x2/y2 and the original gradientTransform, matching
        // vello_svg's convention. Pre-multiplying the endpoints loses information
        // for non-orthogonal transforms (skew / non-uniform scale), which Flash's
        // exporter produces routinely (huge 1638.4 gradient box * tiny matrix).
        // The renderer will pass gradientTransform as the vello brush transform,
        // and vello applies it correctly to the gradient's sample space.
        const x1 = parseFloat($el.attr("x1") ?? "0");
        const y1 = parseFloat($el.attr("y1") ?? "0");
        const x2 = parseFloat($el.attr("x2") ?? "0");
        const y2 = parseFloat($el.attr("y2") ?? "0");
        gradients.push({
          id,
          type: "linear",
          cx: x1, cy: y1,  // raw start in gradient-local space
          fx: x2, fy: y2,  // raw end in gradient-local space
          r: 0,
          gradientTransform: gt,
          stops,
        });
      } else {
        // Radial gradient: keep original behavior
        const cx = parseFloat($el.attr("cx") ?? "0");
        const cy = parseFloat($el.attr("cy") ?? "0");
        gradients.push({
          id,
          type: "radial",
          cx,
          cy,
          fx: parseFloat($el.attr("fx") ?? String(cx)),
          fy: parseFloat($el.attr("fy") ?? String(cy)),
          r: parseFloat($el.attr("r") ?? "0"),
          gradientTransform: gt,
          stops,
        });
      }
    }
  });

  // Parse frames: <g clip-path="url(#...)"> at root level
  $svg.children("g[clip-path]").each((_, frameGroup) => {
    const $frameGroup = $(frameGroup);
    const clipPathAttr = $frameGroup.attr("clip-path") ?? "";
    const clipIdMatch = clipPathAttr.match(/url\(#([^)]+)\)/);
    const clipPathId = clipIdMatch?.[1] ?? "";
    const clipRect = clipPaths.get(clipPathId);

    if (!clipRect) return;

    // Walk nested <g> groups composing transforms until we find uses/rects.
    // New format: <g clip-path> → <g translate(a)> → <g translate(b)> → uses/rects
    // Old format: <g clip-path> → <g translate> → uses/rects
    let $contentGroup = $frameGroup.children("g").first();
    let offsetTransform = parseTransform($contentGroup.attr("transform"));

    // If this group only contains a single <g> child (no uses/rects), descend into it
    while (
      $contentGroup.children().length > 0 &&
      $contentGroup.children("g").length === 1 &&
      $contentGroup.children("use, rect").length === 0
    ) {
      const $nested = $contentGroup.children("g").first();
      const nestedTransform = parseTransform($nested.attr("transform"));
      // Compose parent * child transforms
      const [a1, b1, c1, d1, tx1, ty1] = offsetTransform;
      const [a2, b2, c2, d2, tx2, ty2] = nestedTransform;
      const f = Math.fround;
      offsetTransform = [
        f(f(a1 * a2) + f(c1 * b2)),
        f(f(b1 * a2) + f(d1 * b2)),
        f(f(a1 * c2) + f(c1 * d2)),
        f(f(b1 * c2) + f(d1 * d2)),
        f(f(f(a1 * tx2) + f(c1 * ty2)) + tx1),
        f(f(f(b1 * tx2) + f(d1 * ty2)) + ty1),
      ];
      $contentGroup = $nested;
    }

    const uses: ParsedFrameUse[] = [];
    const accessorySlots: ParsedAccessorySlot[] = [];

    $contentGroup.children().each((_, child) => {
      const tagName = (child as Element).tagName;
      const $child = $(child);

      if (tagName === "use") {
        const href = ($child.attr("xlink:href") ?? $child.attr("href") ?? "").replace("#", "");
        const transform = parseTransform($child.attr("transform"));
        uses.push({ href, transform });
      } else if (tagName === "rect" && $child.attr("data-acc-slot")) {
        const slotId = parseInt($child.attr("data-acc-slot") ?? "0", 10);
        const tx = parseFloat($child.attr("data-tx") ?? "0");
        const ty = parseFloat($child.attr("data-ty") ?? "0");
        const depth = parseFloat($child.attr("data-depth") ?? "0");
        const matrixStr = $child.attr("data-matrix");
        let matrix: AffineTransform | null = null;
        if (matrixStr) {
          const parts = matrixStr.split(",").map(Number);
          matrix = [parts[0] ?? 1, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1, parts[4] ?? 0, parts[5] ?? 0];
        }
        // Track position: this slot renders after `uses.length` body parts
        accessorySlots.push({ slotId, tx, ty, matrix, depth, insertAfterPart: uses.length });
      }
    });

    frames.push({
      clipPathId,
      clipRect,
      offsetTransform,
      uses,
      accessorySlots,
    });
  });

  return { width, height, definitions, clipPaths, patterns, gradients, frames };
}
