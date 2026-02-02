import { component, field } from '@lastolivegames/becsy';

/**
 * Core fighter identity and team assignment.
 * Attached to all entities participating in combat.
 */
@component export class Fighter {
  @field.uint32 declare id: number;
  @field.uint8 declare team: number;
  @field.boolean declare isPlayer: boolean;
  @field.uint8 declare direction: number;
}

/**
 * Fighter combat statistics.
 * HP, AP, MP, and initiative for turn order.
 */
@component export class FighterStats {
  @field.int32 declare hp: number;
  @field.int32 declare maxHp: number;
  @field.int32 declare ap: number;
  @field.int32 declare maxAp: number;
  @field.int32 declare mp: number;
  @field.int32 declare maxMp: number;
  @field.int32 declare initiative: number;
  @field.int32 declare level: number;
}

/**
 * Fighter position on the combat grid.
 * Uses cell ID for isometric map positioning.
 */
@component export class CellPosition {
  @field.uint16 declare cellId: number;
  @field.uint8 declare groundLevel: number;
}

/**
 * Fighter visual appearance and display name.
 */
@component export class FighterLook {
  @field.object declare look: string;
  @field.object declare name: string;
  @field.uint8 declare entityType: number;
}

/**
 * Fighter team constants.
 */
export const FighterTeam = {
  RED: 0,
  BLUE: 1,
} as const;

export type FighterTeamValue = typeof FighterTeam[keyof typeof FighterTeam];

/**
 * Fighter entity type constants.
 */
export const FighterEntityType = {
  PLAYER: 0,
  MONSTER: 1,
  SUMMON: 2,
} as const;

export type FighterEntityTypeValue = typeof FighterEntityType[keyof typeof FighterEntityType];

/**
 * Direction constants (8 directions).
 */
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

export type DirectionValue = typeof Direction[keyof typeof Direction];
