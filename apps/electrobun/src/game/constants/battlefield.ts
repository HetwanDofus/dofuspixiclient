import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  DEPTH_PER_CELL,
  FIRST_SPRITE_DEPTH_ON_CELL,
  LEVEL_HEIGHT,
  MAX_DEPTH_IN_MAP,
  MAX_SPRITES_ON_CELL,
} from "@dofus/grid";

export {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  DEFAULT_CELL_COUNT,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  DEPTH_PER_CELL,
  FIRST_SPRITE_DEPTH_ON_CELL,
  LEVEL_HEIGHT,
  MAX_DEPTH_IN_MAP,
  MAX_SPRITES_ON_CELL,
} from "@dofus/grid";

export const DISPLAY_WIDTH = 742;
export const DISPLAY_HEIGHT = 432;
export const BANNER_HEIGHT = 124;
export const FULL_HEIGHT = DISPLAY_HEIGHT + BANNER_HEIGHT;
export const GAME_WIDTH = 1049;
export const GAME_HEIGHT = 786;

// Widescreen canvas — render to a ~1.95 aspect block so the game area
// (DISPLAY_WIDTH × DISPLAY_HEIGHT = 742×432, native ~1.72 aspect) sits
// centred with two lateral bands AND a new bottom band between the
// game area and the React banner. Each band is fed pre-rendered tile
// art of the corresponding neighbour map (left/right/bottom) by
// `NeighborBandRenderer`, replacing the old `SideBandCompositor`
// downsample-blur of the current map.
//
// Vertical stack inside the central column (top → bottom):
//   - game area     (DISPLAY_HEIGHT)
//   - bottom band   (BOTTOM_BAND_HEIGHT — bottom-neighbour preview)
//   - banner area   (BANNER_HEIGHT     — React HUD sits on top of this)
//
// VIEW_HEIGHT carries all three. VIEW_WIDTH is derived from the target
// aspect so SIDE_BAND_WIDTH stays a wide-enough lateral strip to show
// a real piece of the left/right neighbour map (not just a 50 px sliver).
export const BOTTOM_BAND_HEIGHT = 124;
export const VIEW_ASPECT = 1950 / 1000;
export const VIEW_HEIGHT = DISPLAY_HEIGHT + BOTTOM_BAND_HEIGHT + BANNER_HEIGHT;
export const VIEW_WIDTH = Math.round(VIEW_HEIGHT * VIEW_ASPECT);
export const SIDE_BAND_WIDTH = Math.round((VIEW_WIDTH - DISPLAY_WIDTH) / 2);

export const DEFAULT_WIDTH = 15;
export const DEFAULT_HEIGHT = 17;

export const ROT_SCALE_X = 51.85 / 100;
export const ROT_SCALE_Y = 192.86 / 100;

export const ZOOM_LEVELS = [1, 2, 3, 4, 5] as const;
export const DEFAULT_ZOOM_INDEX = 0;
export const MIN_ZOOM = ZOOM_LEVELS[0];
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

export const DIRECTIONS = {
  EAST: 0,
  SOUTH_EAST: 1,
  SOUTH: 2,
  SOUTH_WEST: 3,
  WEST: 4,
  NORTH_WEST: 5,
  NORTH: 6,
  NORTH_EAST: 7,
} as const;

export type Direction = (typeof DIRECTIONS)[keyof typeof DIRECTIONS];

export const MOVEMENT = {
  NONE: 0,
  WALKABLE: 1,
  DOOR: 2,
  TRIGGER: 3,
  OCCUPIED: 4,
} as const;

export type Movement = (typeof MOVEMENT)[keyof typeof MOVEMENT];

export const MIN_GROUND_LEVEL = 0;
export const MAX_GROUND_LEVEL = 7;
export const DEFAULT_GROUND_LEVEL = 7;

export const MAP_CONSTANTS = {
  DISPLAY_WIDTH,
  DISPLAY_HEIGHT,
  CELL_WIDTH,
  CELL_HEIGHT,
  CELL_HALF_WIDTH,
  CELL_HALF_HEIGHT,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  LEVEL_HEIGHT,
  FIRST_SPRITE_DEPTH_ON_CELL,
  MAX_SPRITES_ON_CELL,
  DEPTH_PER_CELL,
  MAX_DEPTH_IN_MAP,
} as const;
