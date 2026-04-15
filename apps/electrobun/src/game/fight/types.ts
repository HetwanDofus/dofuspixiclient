export const PlayerTeam = {
  RED: 0,
  BLUE: 1,
} as const;

export type FighterTeamValue = (typeof PlayerTeam)[keyof typeof PlayerTeam];

export const FighterEntityType = {
  PLAYER: 0,
  MONSTER: 1,
  SUMMON: 2,
} as const;

export type FighterEntityTypeValue =
  (typeof FighterEntityType)[keyof typeof FighterEntityType];

export const Element = {
  NEUTRAL: 0,
  EARTH: 1,
  FIRE: 2,
  WATER: 3,
  AIR: 4,
} as const;

export type ElementValue = (typeof Element)[keyof typeof Element];

export interface ResizeEvent {
  zoom: number;
  baseZoom: number;
  screenWidth: number;
  screenHeight: number;
}

export const Direction = {
  EAST: 0,
  SOUTH_EAST: 1,
  SOUTH: 2,
  SOUTH_WEST: 3,
  WEST: 4,
  NORTH_WEST: 5,
  NORTH: 6,
  NORTH_EAST: 7,
} as const;

export type DirectionValue = (typeof Direction)[keyof typeof Direction];
