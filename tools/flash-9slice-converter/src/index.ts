/**
 * Flash slice SVG converter.
 *
 * Supports two modes:
 * 1. 9-slice: _mcBg, _mcT, _mcB, _mcL, _mcR pieces (ContainerBackground/Highlight)
 * 2. 3-slice horizontal: left_mc, middle_mc, right_mc pieces (ButtonBackground)
 *
 * For 3-slice, each slice has layered sub-pieces: border_*_mc, highlight_*_mc, bg_*_mc
 * which are rendered bottom-to-top.
 *
 * Usage: bun run src/index.ts <input.svg> <output.svg> [width] [height]
 */

import { readFileSync, writeFileSync } from "node:fs";
import * as cheerio from "cheerio";

interface Piece {
  name: string;
  href: string;
  color: string;
  opacity: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Original 100x100 rect width after scale */
  nativeW: number;
  /** Original 100x100 rect height after scale */
  nativeH: number;
}

interface ExtraPiece {
  x: number;
  y: number;
  pathD: string;
  color: string;
  opacity: number;
}

function parseMatrix(matrix: string): { a: number; b: number; c: number; d: number; tx: number; ty: number } {
  const parts = matrix
    .replace("matrix(", "")
    .replace(")", "")
    .split(",")
    .map((s) => parseFloat(s.trim()));
  return { a: parts[0], b: parts[1], c: parts[2], d: parts[3], tx: parts[4], ty: parts[5] };
}

function resolveFill($: cheerio.CheerioAPI, objectId: string): { color: string; opacity: number } | null {
  const group = $(`#${objectId}`);
  if (!group.length) return null;

  // Direct path child
  const path = group.find("path");
  if (path.length) {
    const color = path.attr("fill") || "#000000";
    const opacity = parseFloat(path.attr("fill-opacity") || "1");
    if (color === "none") return null;
    return { color, opacity };
  }

  // Indirect: <use> inside the group referencing another object
  const innerUse = group.find("use");
  if (innerUse.length) {
    const innerHref = innerUse.attr("xlink:href") || innerUse.attr("href");
    if (innerHref) {
      return resolveFill($, innerHref.replace("#", ""));
    }
  }

  return null;
}

function resolvePathD($: cheerio.CheerioAPI, objectId: string): string | null {
  const group = $(`#${objectId}`);
  if (!group.length) return null;
  const path = group.find("path");
  return path.attr("d") || null;
}

function parse(svgContent: string): { pieces: Piece[]; extras: ExtraPiece[] } {
  const $ = cheerio.load(svgContent, { xml: true });
  const pieces: Piece[] = [];
  const extras: ExtraPiece[] = [];

  // Find all top-level <use> elements (inside the root <g>)
  const rootG = $("svg > g");
  rootG.children("use").each((_, el) => {
    const use = $(el);
    const href = (use.attr("xlink:href") || use.attr("href") || "").replace("#", "");
    const name = use.attr("id") || "";
    const transform = use.attr("transform") || "";

    if (!transform.includes("matrix")) return;

    const m = parseMatrix(transform);
    const fill = resolveFill($, href);
    if (!fill) return;

    // Check if this is a known 9-slice piece or an extra shape
    const knownPieces = ["_mcBg", "_mcT", "_mcB", "_mcL", "_mcR", "_mcTL", "_mcTR", "_mcBL", "_mcBR"];
    if (knownPieces.includes(name)) {
      pieces.push({
        name,
        href,
        color: fill.color,
        opacity: fill.opacity,
        x: m.tx,
        y: m.ty,
        scaleX: m.a,
        scaleY: m.d,
        nativeW: Math.abs(m.a) * 100,
        nativeH: Math.abs(m.d) * 100,
      });
    } else if (!name) {
      // Unnamed piece — could be a corner triangle or other decoration
      // Check if the referenced object has a non-rect path
      const pathD = resolvePathD($, href);
      if (pathD) {
        // Check parent group transform too
        const parentG = $(`#${href}`);
        const parentTransform = parentG.attr("transform") || "";
        let offsetX = m.tx;
        let offsetY = m.ty;
        if (parentTransform.includes("matrix")) {
          const pm = parseMatrix(parentTransform);
          offsetX += pm.tx;
          offsetY += pm.ty;
        }

        extras.push({
          x: offsetX,
          y: offsetY,
          pathD,
          color: fill.color,
          opacity: fill.opacity,
        });
      }
    }
  });

  return { pieces, extras };
}

function detectMode(pieces: Piece[]): "background" | "highlight" {
  // ContainerBackground: all pieces have same scale
  // ContainerHighlight: edges have different scaleX/scaleY (e.g. 0.02 vs 0.01)
  const left = pieces.find((p) => p.name === "_mcL");
  if (left && left.scaleX !== left.scaleY) return "highlight";
  return "background";
}

function render(pieces: Piece[], extras: ExtraPiece[], w: number, h: number): string {
  const mode = detectMode(pieces);
  const bg = pieces.find((p) => p.name === "_mcBg");
  const top = pieces.find((p) => p.name === "_mcT");
  const bottom = pieces.find((p) => p.name === "_mcB");
  const left = pieces.find((p) => p.name === "_mcL");
  const right = pieces.find((p) => p.name === "_mcR");

  const eL = left ? left.nativeW : 0;
  const eR = right ? right.nativeW : 0;
  const eT = top ? top.nativeH : 0;
  const eB = bottom ? bottom.nativeH : 0;

  const rects: string[] = [];

  const rect = (x: number, y: number, rw: number, rh: number, color: string, opacity: number) => {
    if (rw <= 0 || rh <= 0) return;
    const op = opacity < 1 ? ` fill-opacity="${opacity}"` : "";
    rects.push(`  <rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${color}"${op}/>`);
  };

  // Background fill
  if (bg) {
    if (mode === "highlight") {
      // ContainerHighlight: _mcBg fills entire area
      rect(0, 0, w, h, bg.color, bg.opacity);
    } else {
      // ContainerBackground: _mcBg is inset
      // From AS: x=_mcL._width, y=_mcT._height, w=__width - _mcR._width, h=__height - _mcB._height
      rect(eL, eT, w - eR, h - eB, bg.color, bg.opacity);
    }
  }

  // Edges — from AS arrange():
  // _mcT: x=0, y=0, w=__width, h=native
  if (top) rect(0, 0, w, eT, top.color, top.opacity);
  // _mcB: x=0, y=__height - _mcL._width (note: uses L width, not B height — this is the AS code)
  if (bottom) rect(0, h - eL, w, eB, bottom.color, bottom.opacity);
  // _mcL: x=0, y=0, w=native, h=__height
  if (left) rect(0, 0, eL, h, left.color, left.opacity);
  // _mcR: x=__width - _mcR._width, y=0, w=native, h=__height
  if (right) rect(w - eR, 0, eR, h, right.color, right.opacity);

  // Extra shapes (corner triangles, etc.)
  for (const extra of extras) {
    const op = extra.opacity < 1 ? ` fill-opacity="${extra.opacity}"` : "";
    rects.push(`  <g transform="translate(${extra.x},${extra.y})"><path d="${extra.pathD}" fill="${extra.color}"${op}/></g>`);
  }

  return `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${rects.join("\n")}
</svg>`;
}

// ── 3-slice horizontal support (ButtonBackground: left_mc, middle_mc, right_mc) ──

interface SliceLayer {
  name: string;
  color: string;
  opacity: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** For corner pieces: the path data (quarter-circle) */
  pathD?: string;
  pathTransformX?: number;
  pathTransformY?: number;
}

interface ThreeSlice {
  leftW: number;
  rightW: number;
  height: number;
  layers: SliceLayer[];
}

function parse3Slice(svgContent: string): ThreeSlice | null {
  const $ = cheerio.load(svgContent, { xml: true });

  const rootG = $("svg > g");
  const slices = new Map<string, { href: string; x: number; y: number; w: number; h: number }>();

  rootG.children("use").each((_, el) => {
    const use = $(el);
    const name = use.attr("id") || "";
    const href = (use.attr("xlink:href") || use.attr("href") || "").replace("#", "");
    const transform = use.attr("transform") || "";

    if (!["left_mc", "middle_mc", "right_mc"].includes(name)) return;
    const w = parseFloat(use.attr("width") || "0");
    const h = parseFloat(use.attr("height") || "0");

    let tx = 0;
    if (transform.includes("matrix")) {
      const m = parseMatrix(transform);
      tx = m.tx;
    }

    slices.set(name, { href, x: tx, y: 0, w, h });
  });

  if (!slices.has("left_mc") || !slices.has("middle_mc") || !slices.has("right_mc")) {
    return null;
  }

  const leftSlice = slices.get("left_mc")!;
  const rightSlice = slices.get("right_mc")!;
  const height = leftSlice.h;

  // Parse layers from each slice group
  const layers: SliceLayer[] = [];

  for (const [sliceName, slice] of slices) {
    const group = $(`#${slice.href}`);
    if (!group.length) continue;

    group.children("use").each((_, el) => {
      const use = $(el);
      const layerName = use.attr("id") || "";
      const layerHref = (use.attr("xlink:href") || use.attr("href") || "").replace("#", "");
      const transform = use.attr("transform") || "";

      if (!transform.includes("matrix")) return;
      const m = parseMatrix(transform);

      // Resolve fill color by chasing references
      const fill = resolveFill($, layerHref);
      if (!fill) return;

      const layerW = m.a * 100;
      const layerH = m.d * 100;

      // Check if this is a corner piece (quarter-circle path) or a rect
      const pathD = resolvePathD($, layerHref);
      const isCorner = pathD && pathD.includes("Q");

      layers.push({
        name: `${sliceName}:${layerName}`,
        color: fill.color,
        opacity: fill.opacity,
        x: slice.x + m.tx,
        y: m.ty,
        w: layerW,
        h: Math.abs(m.d) < 0 ? -layerH : layerH,
        pathD: isCorner ? pathD : undefined,
        pathTransformX: m.a < 0 ? m.tx + slice.x : undefined,
        pathTransformY: m.d < 0 ? m.ty : undefined,
      });
    });
  }

  return {
    leftW: leftSlice.w,
    rightW: rightSlice.w,
    height,
    layers,
  };
}

function render3Slice(slice: ThreeSlice, w: number, h: number): string {
  const { leftW, rightW, height: origH, layers } = slice;
  const midX = leftW;
  const midW = w - leftW - rightW;
  const rightX = w - rightW;
  const scaleY = h / origH;

  const elements: string[] = [];

  // Group layers by their slice and layer type, then render at target size
  // Layer naming: "left_mc:bg_1_mc", "middle_mc:bg_mc", "right_mc:border_1_mc" etc.
  // Render order: border (bottom), highlight (middle), bg (top) for each slice

  // Sort layers by z-order (border first, then highlight, then bg)
  const zOrder = (name: string): number => {
    if (name.includes("border")) return 0;
    if (name.includes("highlight")) return 1;
    if (name.includes("bg")) return 2;
    return 3;
  };

  const sorted = [...layers].sort((a, b) => zOrder(a.name) - zOrder(b.name));

  // Find the original right slice X offset (the left edge of the right_mc group)
  // In the original SVG, right_mc is placed at a specific tx. We need to know
  // where the right slice starts so we can reposition it to rightX.
  const rightLayers = sorted.filter((l) => l.name.startsWith("right_mc:"));
  // The right slice pieces include negative-width mirrored items; use x + w to find left edge
  const origRightStartX = rightLayers.length > 0
    ? Math.min(...rightLayers.map((l) => l.w < 0 ? l.x + l.w : l.x))
    : leftW + midW;

  for (const layer of sorted) {
    const op = layer.opacity < 1 ? ` fill-opacity="${layer.opacity}"` : "";
    const isLeft = layer.name.startsWith("left_mc:");
    const isRight = layer.name.startsWith("right_mc:");
    const isMiddle = layer.name.startsWith("middle_mc:");

    // Rect piece
    let x = layer.x;
    let y = layer.y;
    let rw = layer.w;
    let rh = layer.h * scaleY;

    if (isMiddle) {
      // Middle stretches to fill the gap between left and right
      x = midX;
      rw = midW;
    } else if (isRight) {
      // Right slice: offset from original position to new right edge
      x = rightX + (layer.x - origRightStartX);
    }
    // Left pieces stay at their original x

    // Handle negative height (flipped pieces — drawn upward from y position)
    if (layer.h < 0) {
      rh = Math.abs(layer.h) * scaleY;
      y = layer.y * scaleY - rh; // y is the bottom, so top = y - h
    }

    // Handle negative width (mirrored right pieces)
    if (rw < 0) {
      rw = Math.abs(rw);
      x = x - rw;
    }

    // Clamp to viewBox
    if (x < 0) { rw += x; x = 0; }
    if (y < 0) { rh += y; y = 0; }
    if (x + rw > w) rw = w - x;
    if (y + rh > h) rh = h - y;

    if (rw > 0 && rh > 0) {
      elements.push(`  <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${rw.toFixed(2)}" height="${rh.toFixed(2)}" fill="${layer.color}"${op}/>`);
    }
  }

  return `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${elements.join("\n")}
</svg>`;
}

// ── Main ──

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: bun run src/index.ts <input.svg> <output.svg> [width] [height]");
  process.exit(1);
}

const inputPath = args[0];
const outputPath = args[1];
const targetW = parseInt(args[2] || "100", 10);
const targetH = parseInt(args[3] || "100", 10);

const svgContent = readFileSync(inputPath, "utf-8");

// Try 3-slice first (ButtonBackground)
const threeSlice = parse3Slice(svgContent);
if (threeSlice) {
  console.log(`Detected 3-slice button: leftW=${threeSlice.leftW}, rightW=${threeSlice.rightW}, height=${threeSlice.height}`);
  console.log(`${threeSlice.layers.length} layers found`);
  for (const l of threeSlice.layers) {
    console.log(`  ${l.name}: color=${l.color} ${l.w.toFixed(1)}x${l.h.toFixed(1)} at (${l.x},${l.y})${l.pathD ? " [path]" : ""}`);
  }
  console.log(`Rendering at ${targetW}x${targetH}...`);
  const output = render3Slice(threeSlice, targetW, targetH);
  writeFileSync(outputPath, output);
  console.log(`Written to ${outputPath}`);
} else {
  // Fall back to 9-slice
  const { pieces, extras } = parse(svgContent);

  console.log(`Parsed ${pieces.length} 9-slice pieces, ${extras.length} extras:`);
  for (const p of pieces) {
    console.log(`  ${p.name}: color=${p.color} opacity=${p.opacity} native=${p.nativeW}x${p.nativeH}`);
  }
  for (const e of extras) {
    console.log(`  [extra]: color=${e.color} at (${e.x},${e.y})`);
  }

  console.log(`Mode: ${detectMode(pieces)}`);
  console.log(`Rendering at ${targetW}x${targetH}...`);

  const output = render(pieces, extras, targetW, targetH);
  writeFileSync(outputPath, output);
  console.log(`Written to ${outputPath}`);
}
