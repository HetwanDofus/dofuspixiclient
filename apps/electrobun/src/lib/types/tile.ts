export type TileType = "ground" | "objects";

export interface FrameInfo {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export interface TileManifest {
  id: number;
  type: TileType;
  behavior: string | null;
  fps: number | null;
  autoplay: boolean | null;
  loop: boolean | null;
  frameCount: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frames: FrameInfo[];
}
