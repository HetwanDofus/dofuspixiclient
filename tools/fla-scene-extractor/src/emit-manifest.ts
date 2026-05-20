import * as fs from "node:fs";
import * as path from "node:path";

import type {
  ParsedBitmap,
  ParsedElement,
  ParsedSymbol,
} from "./parse-xml.ts";
import { collectLabelStyles } from "./label-styles.ts";
import type {
  BitmapEntry,
  LabelStyle,
  SceneLayer,
  SceneManifest,
  SceneNode,
  ShapeEntry,
  SymbolDescriptor,
} from "./types.ts";

type EmitOptions = {
  sceneName: string;
  rootSymbol: ParsedSymbol;
  parsedSymbols: Map<string, ParsedSymbol>;
  bitmaps: ParsedBitmap[];
  shapesDir: string; // disk path where swf-searcher SVGs live
  shapesPublicPrefix: string; // URL prefix for shape SVGs (e.g. "/assets/scenes/login/shapes/")
  bitmapsPublicPrefix: string; // URL prefix for bitmaps (e.g. "/assets/scenes/login/")
  baseWidth: number;
  baseHeight: number;
};

export function emitManifest(opts: EmitOptions): SceneManifest {
  const {
    sceneName,
    rootSymbol,
    parsedSymbols,
    bitmaps,
    shapesDir,
    shapesPublicPrefix,
    bitmapsPublicPrefix,
    baseWidth,
    baseHeight,
  } = opts;

  const symbols: Record<string, SymbolDescriptor> = {};
  const linkages: Record<string, string> = {};
  const shapesUsed = new Set<string>();
  const bitmapsUsed = new Set<string>();
  const styleNamesUsed = new Set<string>();

  // Sort symbols by libraryItemName for deterministic output.
  const sortedSymbols = [...parsedSymbols.values()].sort((a, b) =>
    a.libraryItemName.localeCompare(b.libraryItemName),
  );

  for (const sym of sortedSymbols) {
    const layers: SceneLayer[] = [];

    for (const layer of sym.layers) {
      const nodes: SceneNode[] = [];
      for (const el of layer.elements) {
        const node = toSceneNode(el, sym, bitmaps, bitmapsUsed, shapesUsed);
        if (!node) continue;
        if (node.kind === "text" || node.kind === "instance") {
          collectStyleNamesFromNode(el, styleNamesUsed);
        }
        nodes.push(node);
      }
      layers.push({ name: layer.name, nodes });
    }

    const desc: SymbolDescriptor = {
      symbolId: sym.symbolId,
      libraryItemName: sym.libraryItemName,
      linkageIdentifier: sym.linkageIdentifier,
      // Symbol intrinsic width/height not directly available in FLA XML;
      // callers can override per-symbol via post-processing. Default to
      // scene base size for the root; sub-symbols start at 0 and rely on
      // a later resolution pass (e.g. SVG bounds from swf-searcher).
      width: sym.libraryItemName === rootSymbol.libraryItemName ? baseWidth : 0,
      height: sym.libraryItemName === rootSymbol.libraryItemName ? baseHeight : 0,
      layers,
    };

    symbols[sym.libraryItemName] = desc;

    if (sym.linkageIdentifier) {
      linkages[sym.linkageIdentifier] = sym.libraryItemName;
    }
  }

  const bitmapsOut: Record<string, BitmapEntry> = {};
  const bitmapByName = new Map(bitmaps.map((b) => [b.name, b]));
  for (const name of [...bitmapsUsed].sort()) {
    const b = bitmapByName.get(name);
    if (!b) continue;
    bitmapsOut[name] = {
      file: `${bitmapsPublicPrefix}${b.href}`,
      width: b.width,
      height: b.height,
    };
  }

  const shapesOut: Record<string, ShapeEntry> = {};
  for (const ref of [...shapesUsed].sort()) {
    const onDisk = path.join(shapesDir, ref);
    const exists = fs.existsSync(onDisk);
    let w = 0;
    let h = 0;
    if (exists) {
      const dims = readSvgBounds(onDisk);
      w = dims.w;
      h = dims.h;
    }
    shapesOut[ref] = {
      file: `${shapesPublicPrefix}${ref}`,
      bounds: { x: 0, y: 0, w, h },
    };
  }

  const labelStyles: Record<string, LabelStyle> = collectLabelStyles(styleNamesUsed);

  return {
    schemaVersion: 1,
    scene: sceneName,
    rootSymbolId: rootSymbol.symbolId,
    baseWidth,
    baseHeight,
    symbols: sortObject(symbols),
    linkages: sortObject(linkages),
    bitmaps: bitmapsOut,
    shapes: shapesOut,
    labelStyles,
  };
}

function toSceneNode(
  el: ParsedElement,
  containingSymbol: ParsedSymbol,
  bitmaps: ParsedBitmap[],
  bitmapsUsed: Set<string>,
  shapesUsed: Set<string>,
): SceneNode | undefined {
  if (el.kind === "instance") {
    if (el.alphaMultiplier === 0) {
      // Hidden hit-area placeholder. Render at zero alpha — keep node so
      // overrides can still target it by name, but mark via empty props.
    }
    return {
      kind: "instance",
      libraryItemName: el.libraryItemName,
      name: el.name,
      matrix: el.matrix,
      centerPoint: el.centerPoint,
      props: el.props,
    };
  }
  if (el.kind === "text") {
    return {
      kind: "text",
      matrix: el.matrix,
      width: el.width,
      height: el.height,
      alignment: el.alignment,
      runs: el.runs,
      multiline: el.multiline,
    };
  }
  if (el.kind === "shape") {
    if (el.hasBitmapFill && el.bitmapFillPath) {
      const bm = bitmaps.find((b) => b.name === el.bitmapFillPath);
      if (bm) {
        bitmapsUsed.add(bm.name);
        return {
          kind: "bitmap",
          bitmapRef: bm.name,
          matrix: el.matrix,
          width: bm.width,
          height: bm.height,
        };
      }
    }
    // Fallback to swf-searcher-extracted SVG of the containing symbol.
    const svgFile = `${containingSymbol.symbolId}.svg`;
    shapesUsed.add(svgFile);
    return { kind: "shape", svgRef: svgFile, matrix: el.matrix };
  }
  return undefined;
}

function collectStyleNamesFromNode(el: ParsedElement, sink: Set<string>) {
  if (el.kind !== "instance") return;
  const styleName = el.props?.styleName;
  if (typeof styleName === "string" && styleName.length > 0) {
    sink.add(styleName);
  }
}

const SVG_WIDTH = /\bwidth=["']([\d.]+)/;
const SVG_HEIGHT = /\bheight=["']([\d.]+)/;
const SVG_VIEWBOX = /\bviewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)/;

function readSvgBounds(file: string): { w: number; h: number } {
  // Cheap header-only read — SVGs may be huge with embedded bitmaps.
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(4096);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const header = buf.slice(0, bytes).toString("utf8");
    const vb = SVG_VIEWBOX.exec(header);
    if (vb) return { w: Number(vb[3]), h: Number(vb[4]) };
    const w = SVG_WIDTH.exec(header);
    const h = SVG_HEIGHT.exec(header);
    return { w: w ? Number(w[1]) : 0, h: h ? Number(h[1]) : 0 };
  } finally {
    fs.closeSync(fd);
  }
}

function sortObject<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  );
}
