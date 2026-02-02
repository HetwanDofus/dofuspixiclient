import type { Sprite, Graphics, Container } from 'pixi.js';

export interface WorldMapBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface WorldMapTile {
  x: number;
  y: number;
  file: string;
}

export interface WorldMapManifest {
  worldmap: string;
  grid_size: number;
  tile_size: number;
  format: string;
  bounds: WorldMapBounds;
  tiles: WorldMapTile[];
}

export interface HintGraphic {
  file: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface HintManifest {
  supersample: number;
  graphics: Record<string, HintGraphic>;
}

export interface HintCategory {
  id: number;
  name: string;
  color: string;
}

export interface HintEntry {
  name: string;
  categoryID: number;
  category: string;
  color: string;
  gfxID: number;
}

export interface HintsData {
  categories: HintCategory[];
  hints_by_map: Record<string, HintEntry[]>;
}

export interface HintOverlayEntry {
  name: string;
  categoryID: number;
  gfxID: number;
  mapID: number;
}

export interface HintOverlay {
  x: number;
  y: number;
  hints: HintOverlayEntry[];
}

export interface HintsLayering {
  hint_overlays: HintOverlay[];
}

export interface MapCoordinate {
  x: number;
  y: number;
  sua: number;
}

export type MapCoordinates = Record<string, MapCoordinate>;

export interface HintSpriteData {
  baseX: number;
  baseY: number;
  hintData: HintOverlayEntry;
  groupKey: string;
}

export interface HintGroup {
  sprites: Sprite[];
  hitArea: Graphics | null;
  visualCircle: Graphics | null;
  isSpread: boolean;
}

export interface WorldMapConfig {
  container: HTMLElement;
  width?: number;
  height?: number;
  backgroundColor?: number;
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  interactive?: boolean;
}

export interface MinimapConfig {
  app: import('pixi.js').Application;
  container: Container;
  size: number;
  zoom?: number;
}

export const WORLDMAP_CONSTANTS = {
  DISPLAY_WIDTH: 742,
  DISPLAY_HEIGHT: 432,
  CHUNK_SIZE: 15,
  DEFAULT_ZOOM: 50,
  MIN_ZOOM: 10,
  MAX_ZOOM: 200,
  ZOOM_STEP: 5,
} as const;

export const HINT_COLORS: Record<string, number> = {
  Orange: 0xff8800,
  Blue: 0x4488ff,
  Green: 0x44ff44,
  Beige: 0xf5deb3,
  Red: 0xff4444,
  Violet: 0x8844ff,
};
