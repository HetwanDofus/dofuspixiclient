export type TileType = "ground" | "objects" | "tactic" | "cell";

/**
 * Tile behavior classification.
 *
 * - static:   single frame, no animation
 * - slope:    ground tile with frames indexed by groundSlope
 * - animated: auto-playing animation loop
 * - random:   one frame picked per cell (cellId % frameCount)
 * - resource: interactive/harvestable object
 */
export type TileBehavior =
  | "static"
  | "slope"
  | "animated"
  | "random"
  | "resource";

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
  /** Multi-page atlas page files + dimensions. Absent = single-page atlas. */
  pages?: Array<{ file: string; width: number; height: number }>;
  /**
   * Where each state of an interactive element sits in `frames`, keyed by the
   * 1.29 frame number the server names in `GDF`. Present on `resource` tiles
   * only; see `TileExtrasState` in `@dofus/dofasset-format`.
   */
  states?: TileState[];
}

/** One run of `TileManifest.frames` — a resting image, or a transition. */
export interface TileState {
  /** The 1-based frame number `GDF` carries (1 = ready, 3 = spent…). */
  frame: number;
  start: number;
  count: number;
}
