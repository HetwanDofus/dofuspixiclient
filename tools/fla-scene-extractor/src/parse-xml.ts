import * as fs from "node:fs";

import { XMLParser } from "fast-xml-parser";

import { parseActionscriptConstruct } from "./parse-actionscript.ts";
import {
  IDENTITY_MATRIX,
  type Matrix,
  type SymbolInstanceProps,
  type TextAlign,
  type TextRun,
} from "./types.ts";

// fast-xml-parser config:
// - preserveOrder yields ordered children (we need layer order)
// - attributes get an "@" prefix so they don't collide with element names
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  preserveOrder: false,
  allowBooleanAttributes: true,
  alwaysCreateTextNode: false,
});

export type ParsedShape = {
  kind: "shape";
  matrix: Matrix;
  hasBitmapFill: boolean;
  bitmapFillPath?: string;
};

export type ParsedText = {
  kind: "text";
  name?: string;
  matrix: Matrix;
  width: number;
  height: number;
  alignment: TextAlign;
  multiline?: boolean;
  runs: TextRun[];
};

export type ParsedInstance = {
  kind: "instance";
  libraryItemName: string;
  name?: string;
  matrix: Matrix;
  centerPoint?: { x: number; y: number };
  props?: SymbolInstanceProps;
  alphaMultiplier?: number;
};

export type ParsedElement = ParsedInstance | ParsedShape | ParsedText;

export type ParsedLayer = {
  name: string;
  elements: ParsedElement[];
};

export type ParsedSymbol = {
  filePath: string;
  symbolId: string;
  libraryItemName: string;
  linkageIdentifier?: string;
  layers: ParsedLayer[];
};

export type ParsedBitmap = {
  name: string;
  href: string;
  width: number;
  height: number;
};

export function parseDomDocumentBitmaps(domDocPath: string): ParsedBitmap[] {
  const xml = fs.readFileSync(domDocPath, "utf8");
  const root = parser.parse(xml);
  const media = root.DOMDocument?.media;
  if (!media) return [];

  const items = toArray(media.DOMBitmapItem);
  return items.map((b) => ({
    name: String(b["@name"] ?? ""),
    href: String(b["@href"] ?? b["@name"] ?? ""),
    // FLA stores bitmap dimensions in TWIPS (1px = 20 twips).
    width: Number(b["@frameRight"] ?? 0) / 20,
    height: Number(b["@frameBottom"] ?? 0) / 20,
  }));
}

export function parseSymbolFile(filePath: string): ParsedSymbol {
  const xml = fs.readFileSync(filePath, "utf8");
  const root = parser.parse(xml);
  const sym = root.DOMSymbolItem;
  if (!sym) {
    throw new Error(`Not a DOMSymbolItem: ${filePath}`);
  }

  const libraryItemName = String(sym["@name"] ?? "");
  const linkageIdentifier = sym["@linkageIdentifier"]
    ? String(sym["@linkageIdentifier"])
    : undefined;

  const symbolId = symbolIdFromName(libraryItemName);

  const timeline = (sym as XmlNode).timeline as XmlNode | undefined;
  const domTimeline = timeline?.DOMTimeline as XmlNode | undefined;
  const layersWrap = domTimeline?.layers as XmlNode | undefined;
  const rawLayers = toArray(layersWrap?.DOMLayer);

  const layers: ParsedLayer[] = rawLayers.map((layer) => parseLayer(layer));

  return {
    filePath,
    symbolId,
    libraryItemName,
    linkageIdentifier,
    layers,
  };
}

function parseLayer(layer: XmlNode): ParsedLayer {
  const name = String(layer["@name"] ?? "Layer");
  const framesWrap = layer.frames as XmlNode | undefined;
  const frames = toArray(framesWrap?.DOMFrame);
  // Static UI scenes only use frame 0.
  const frame0 = frames.find((f) => String(f["@index"] ?? "0") === "0") ?? frames[0];
  if (!frame0) return { name, elements: [] };

  const elementsRoot = frame0.elements as XmlNode | undefined;
  if (!elementsRoot) return { name, elements: [] };

  const elements: ParsedElement[] = [];

  // fast-xml-parser merges same-named siblings into arrays, but loses order
  // when types are mixed. We rebuild order by walking known element types.
  for (const inst of toArray(elementsRoot.DOMSymbolInstance)) {
    elements.push(parseInstance(inst));
  }
  for (const shape of toArray(elementsRoot.DOMShape)) {
    elements.push(parseShape(shape));
  }
  for (const text of toArray(elementsRoot.DOMStaticText)) {
    elements.push(parseText(text));
  }
  for (const text of toArray(elementsRoot.DOMDynamicText)) {
    elements.push(parseText(text));
  }

  return { name, elements };
}

function parseInstance(node: XmlNode): ParsedInstance {
  const matrix = parseMatrix(node.matrix as XmlNode | undefined);
  const libraryItemName = String(node["@libraryItemName"] ?? "");
  const name = node["@name"] ? String(node["@name"]) : undefined;
  const cx = node["@centerPoint3DX"];
  const cy = node["@centerPoint3DY"];
  const centerPoint = cx !== undefined && cy !== undefined
    ? { x: Number(cx), y: Number(cy) }
    : undefined;

  const script = extractActionscript(node);
  const props = parseActionscriptConstruct(script);

  const colorWrap = node.color as XmlNode | undefined;
  const colorNode = colorWrap?.Color as XmlNode | undefined;
  const alphaMultiplier = colorNode?.["@alphaMultiplier"] !== undefined
    ? Number(colorNode["@alphaMultiplier"])
    : undefined;

  return {
    kind: "instance",
    libraryItemName,
    name,
    matrix,
    centerPoint,
    props,
    alphaMultiplier,
  };
}

function extractActionscript(node: XmlNode): string | undefined {
  const asNode = node.Actionscript as XmlNode | undefined;
  if (!asNode) return undefined;
  const script = asNode.script;
  if (typeof script === "string") return script;
  if (script && typeof script === "object") {
    const text = (script as XmlNode)["#text"];
    if (typeof text === "string") return text;
  }
  return undefined;
}

function parseShape(node: XmlNode): ParsedShape {
  const matrix = parseMatrix(node.matrix as XmlNode | undefined);
  const fillsWrap = node.fills as XmlNode | undefined;
  const fillEntries = toArray(fillsWrap?.FillStyle);
  let hasBitmapFill = false;
  let bitmapFillPath: string | undefined;
  for (const fill of fillEntries) {
    const bf = fill.BitmapFill as XmlNode | undefined;
    if (bf) {
      hasBitmapFill = true;
      bitmapFillPath = bf["@bitmapPath"] ? String(bf["@bitmapPath"]) : bitmapFillPath;
    }
  }
  return { kind: "shape", matrix, hasBitmapFill, bitmapFillPath };
}

function parseText(node: XmlNode): ParsedText {
  const matrix = parseMatrix(node.matrix as XmlNode | undefined);
  const width = Number(node["@width"] ?? 0);
  const height = Number(node["@height"] ?? 0);
  const name = node["@name"] ? String(node["@name"]) : undefined;
  const multiline = node["@lineType"] === "multiline" || undefined;

  const textRunsContainer = node.textRuns as XmlNode | undefined;
  const runs: TextRun[] = [];
  let alignment: TextAlign = "left";

  for (const run of toArray(textRunsContainer?.DOMTextRun)) {
    const charsNode = run.characters;
    const characters = typeof charsNode === "string"
      ? charsNode
      : (charsNode as XmlNode | undefined)?.["#text"] !== undefined
        ? String((charsNode as XmlNode)["#text"])
        : "";
    const attrsWrap = run.textAttrs as XmlNode | undefined;
    const attrsRoot = attrsWrap?.DOMTextAttrs as XmlNode | undefined;
    const align = attrsRoot?.["@alignment"];
    if (align === "left" || align === "center" || align === "right" || align === "justify") {
      alignment = align;
    }
    const face = String(attrsRoot?.["@face"] ?? "Verdana");
    const size = Number(attrsRoot?.["@size"] ?? 12);
    const fillColor = String(attrsRoot?.["@fillColor"] ?? "#000000");
    const bold = attrsRoot?.["@bold"] === "true";
    const italic = attrsRoot?.["@italic"] === "true";
    const letterSpacing = attrsRoot?.["@letterSpacing"] !== undefined
      ? Number(attrsRoot["@letterSpacing"])
      : undefined;
    runs.push({ characters, face, size, fillColor, bold, italic, letterSpacing });
  }

  return { kind: "text", name, matrix, width, height, alignment, multiline, runs };
}

function parseMatrix(container: XmlNode | undefined): Matrix {
  if (!container) return { ...IDENTITY_MATRIX };
  const m = container.Matrix as XmlNode | undefined;
  if (!m) return { ...IDENTITY_MATRIX };
  return {
    a: m["@a"] !== undefined ? Number(m["@a"]) : 1,
    b: m["@b"] !== undefined ? Number(m["@b"]) : 0,
    c: m["@c"] !== undefined ? Number(m["@c"]) : 0,
    d: m["@d"] !== undefined ? Number(m["@d"]) : 1,
    tx: m["@tx"] !== undefined ? Number(m["@tx"]) : 0,
    ty: m["@ty"] !== undefined ? Number(m["@ty"]) : 0,
  };
}

type XmlNode = Record<string, unknown>;

function toArray(maybeArr: unknown): XmlNode[] {
  if (maybeArr === undefined || maybeArr === null) return [];
  if (Array.isArray(maybeArr)) return maybeArr as XmlNode[];
  return [maybeArr as XmlNode];
}

export function symbolIdFromName(libraryItemName: string): string {
  const match = /^Symbol\s+(\d+)$/i.exec(libraryItemName.trim());
  return match ? match[1] : libraryItemName;
}
