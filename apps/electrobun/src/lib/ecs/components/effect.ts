import { component, field } from '@lastolivegames/becsy';

/**
 * Effect type constants matching Dofus protocol.
 * Based on GameActions.onActions action codes.
 */
export const EffectType = {
  // Damage types
  DAMAGE_NEUTRAL: 100,
  DAMAGE_EARTH: 97,
  DAMAGE_FIRE: 98,
  DAMAGE_WATER: 96,
  DAMAGE_AIR: 99,
  STEAL_HP_NEUTRAL: 95,
  STEAL_HP_EARTH: 92,
  STEAL_HP_FIRE: 93,
  STEAL_HP_WATER: 91,
  STEAL_HP_AIR: 94,

  // Healing
  HEAL: 108,

  // AP/MP modification
  REMOVE_AP: 168,
  GIVE_AP: 111,
  REMOVE_MP: 169,
  GIVE_MP: 128,

  // Movement effects
  PUSH: 5,
  PULL: 6,
  TELEPORT: 4,
  SWITCH_POSITIONS: 8,

  // State effects
  INVISIBILITY: 150,
  CARRY: 50,
  THROW: 51,

  // Summon effects
  SUMMON: 180,
  SUMMON_STATIC: 181,

  // Glyph/Trap effects
  GLYPH: 401,
  TRAP: 400,

  // Buff/Debuff
  ADD_DAMAGE: 112,
  ADD_DAMAGE_PERCENT: 138,
  ADD_CRITICAL: 115,
  ADD_RANGE: 117,
  REDUCE_DAMAGE: 105,
  REFLECT_DAMAGE: 107,
} as const;

export type EffectTypeValue = typeof EffectType[keyof typeof EffectType];

/**
 * Element type constants.
 */
export const Element = {
  NEUTRAL: 0,
  EARTH: 1,
  FIRE: 2,
  WATER: 3,
  AIR: 4,
} as const;

export type ElementValue = typeof Element[keyof typeof Element];

/**
 * Active effect on a fighter.
 * Tracks buffs, debuffs, and ongoing effects.
 */
@component export class ActiveEffect {
  @field.uint16 declare type: number;
  @field.int32 declare value: number;
  @field.int32 declare param1: number;
  @field.int32 declare param2: number;
  @field.uint8 declare turnsRemaining: number;
  @field.boolean declare dispellable: boolean;
  @field.uint32 declare sourceId: number;
  @field.uint32 declare spellId: number;
}

/**
 * Effect indicator for UI display.
 * Shows buff/debuff icons on fighter portraits.
 */
@component export class EffectIndicator {
  @field.uint16 declare iconId: number;
  @field.boolean declare isBuff: boolean;
  @field.uint8 declare element: number;
}

/**
 * Pending damage for grouped display.
 * Accumulates damage during action resolution.
 */
@component export class PendingDamage {
  @field.int32 declare amount: number;
  @field.uint8 declare element: number;
  @field.boolean declare isCritical: boolean;
  @field.float32 declare timestamp: number;
}
