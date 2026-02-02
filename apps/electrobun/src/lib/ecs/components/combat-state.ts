import { component, field } from '@lastolivegames/becsy';

/**
 * Combat phase constants.
 */
export const CombatPhase = {
  NONE: 0,
  PLACEMENT: 1,
  FIGHTING: 2,
  ENDING: 3,
} as const;

export type CombatPhaseValue = typeof CombatPhase[keyof typeof CombatPhase];

/**
 * Turn state constants for player actions.
 */
export const TurnState = {
  WAITING: 0,
  ACTIVE: 1,
  TRANSMITTING: 2,
  ANIMATING: 3,
} as const;

export type TurnStateValue = typeof TurnState[keyof typeof TurnState];

/**
 * Combat fight type constants.
 */
export const FightType = {
  CHALLENGE: 0,
  AGGRESSION: 1,
  PVP_DUEL: 2,
  PVP_ATTACK: 3,
  MONSTER: 4,
} as const;

export type FightTypeValue = typeof FightType[keyof typeof FightType];

/**
 * Global combat context.
 * Singleton entity tracking the current fight state.
 */
@component export class CombatContext {
  @field.uint32 declare fightId: number;
  @field.uint8 declare fightType: number;
  @field.uint8 declare phase: number;
  @field.uint16 declare round: number;
  @field.uint32 declare currentTurnFighterId: number;
  @field.float32 declare turnStartTime: number;
  @field.float32 declare turnDuration: number;
  @field.object declare turnSequence: number[];
  @field.boolean declare spectatorMode: boolean;
}

/**
 * Player-specific turn state.
 * Tracks the local player's combat status.
 */
@component export class PlayerTurnState {
  @field.uint8 declare state: number;
  @field.boolean declare ready: boolean;
  @field.uint16 declare startCellId: number;
}

/**
 * Team placement cells.
 * Available cells for team placement during preparation phase.
 */
@component export class TeamPlacement {
  @field.uint8 declare team: number;
  @field.object declare cells: number[];
}
