// Mirror of registry types (must stay in sync with the consumer registry's
// scenes/_shared/types.ts).

export type Matrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};

export const IDENTITY_MATRIX: Matrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

export type FlaColor = string;

export type SymbolInstanceProps = {
  styleName?: string;
  text?: string;
  backgroundUp?: string;
  backgroundDown?: string;
  backgroundDisabled?: string;
  icon?: string;
  enabled?: boolean;
  multiline?: boolean;
  wordWrap?: boolean;
  html?: boolean;
  [extraKey: string]: string | number | boolean | undefined;
};

export type TextRun = {
  characters: string;
  face: string;
  size: number;
  fillColor: FlaColor;
  bold?: boolean;
  italic?: boolean;
  letterSpacing?: number;
};

export type TextAlign = "left" | "center" | "right" | "justify";

export type SceneNode =
  | {
      kind: "instance";
      libraryItemName: string;
      name?: string;
      matrix: Matrix;
      centerPoint?: { x: number; y: number };
      props?: SymbolInstanceProps;
    }
  | {
      kind: "shape";
      svgRef: string;
      matrix: Matrix;
    }
  | {
      kind: "bitmap";
      bitmapRef: string;
      matrix: Matrix;
      width: number;
      height: number;
    }
  | {
      kind: "text";
      matrix: Matrix;
      width: number;
      height: number;
      alignment: TextAlign;
      runs: TextRun[];
      multiline?: boolean;
    };

export type SceneLayer = {
  name: string;
  nodes: SceneNode[];
};

export type SymbolDescriptor = {
  symbolId: string;
  libraryItemName: string;
  linkageIdentifier?: string;
  width: number;
  height: number;
  layers: SceneLayer[];
};

export type LabelStyle = {
  face: string;
  size: number;
  color: FlaColor;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  leading?: number;
};

export type BitmapEntry = {
  file: string;
  width: number;
  height: number;
};

export type ShapeEntry = {
  file: string;
  bounds: { x: number; y: number; w: number; h: number };
};

export type SceneManifest = {
  schemaVersion: 1;
  scene: string;
  rootSymbolId: string;
  baseWidth: number;
  baseHeight: number;
  symbols: Record<string, SymbolDescriptor>;
  linkages: Record<string, string>;
  bitmaps: Record<string, BitmapEntry>;
  shapes: Record<string, ShapeEntry>;
  labelStyles: Record<string, LabelStyle>;
};
