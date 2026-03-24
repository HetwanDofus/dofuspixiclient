export type TileType = "ground" | "objects";

/**
 * Tile behavior classification.
 *
 * - static:   single frame, no animation
 * - slope:    ground tile with frames indexed by groundSlope
 * - animated: auto-playing animation loop
 * - random:   one frame picked per cell (cellId % frameCount)
 * - resource: interactive/harvestable object
 */
export type TileBehavior = "static" | "slope" | "animated" | "random" | "resource";

export interface FrameInfo {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** For multi-page atlases: index into the pages[] array. Absent or 0 = first/only page. */
  page?: number;
}

export interface TileManifest {
  id: number;
  type: TileType;
  behavior: TileBehavior;
  fps: number | null;
  autoplay: boolean | null;
  loop: boolean | null;
  frameCount: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frames: FrameInfo[];
  /** Base frame for base/delta splitting (shared static elements) */
  baseFrame?: FrameInfo;
  /** Whether the base renders "above" or "below" the delta. Default "above". */
  baseZOrder?: "above" | "below";
  /** Multi-page atlas: SVG files with their dimensions. Absent = single atlas.svg. */
  pages?: Array<{ file: string; width: number; height: number }>;
}
