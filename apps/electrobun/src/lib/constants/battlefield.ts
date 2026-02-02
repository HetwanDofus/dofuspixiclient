export const DISPLAY_WIDTH = 742;
export const DISPLAY_HEIGHT = 432;
export const BANNER_HEIGHT = 125;
export const FULL_HEIGHT = DISPLAY_HEIGHT + BANNER_HEIGHT; // 557
export const GAME_WIDTH = 1049;
export const GAME_HEIGHT = 786;

export const CELL_WIDTH = 53;
export const CELL_HEIGHT = 27;
export const CELL_HALF_WIDTH = 26.5;
export const CELL_HALF_HEIGHT = 13.5;
export const LEVEL_HEIGHT = 20;

export const DEFAULT_MAP_WIDTH = 15;
export const DEFAULT_MAP_HEIGHT = 17;
export const DEFAULT_WIDTH = DEFAULT_MAP_WIDTH;
export const DEFAULT_HEIGHT = DEFAULT_MAP_HEIGHT;
export const DEFAULT_CELL_COUNT = DEFAULT_MAP_WIDTH * DEFAULT_MAP_HEIGHT * 2 - DEFAULT_MAP_WIDTH;

export const FIRST_SPRITE_DEPTH_ON_CELL = 30;
export const MAX_SPRITES_ON_CELL = 100;
export const DEPTH_PER_CELL = 100;
export const MAX_DEPTH_IN_MAP = 100000;

export const ROT_SCALE_X = 51.85 / 100;
export const ROT_SCALE_Y = 192.86 / 100;

export const ZOOM_LEVELS = [1, 1.5, 2, 3] as const;
export const DEFAULT_ZOOM_INDEX = 0;
export const MIN_ZOOM = ZOOM_LEVELS[0];
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

// Available asset scales from the packer
export const ASSET_SCALES = [1.5, 2, 2.5, 3, 3.5, 4] as const;

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

export type Direction = typeof DIRECTIONS[keyof typeof DIRECTIONS];

export const MOVEMENT = {
  NONE: 0,
  WALKABLE: 1,
  DOOR: 2,
  TRIGGER: 3,
  OCCUPIED: 4,
} as const;

export type Movement = typeof MOVEMENT[keyof typeof MOVEMENT];

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
  DEFAULT_WIDTH: DEFAULT_MAP_WIDTH,
  DEFAULT_HEIGHT: DEFAULT_MAP_HEIGHT,
  LEVEL_HEIGHT,
  FIRST_SPRITE_DEPTH_ON_CELL,
  MAX_SPRITES_ON_CELL,
  DEPTH_PER_CELL,
  MAX_DEPTH_IN_MAP,
} as const;
