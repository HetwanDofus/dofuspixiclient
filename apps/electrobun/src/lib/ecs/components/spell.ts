import { component, field } from '@lastolivegames/becsy';

/**
 * Zone shape constants for spell area of effect.
 */
export const ZoneShape = {
  SINGLE: 0,
  CROSS: 1,
  CIRCLE: 2,
  LINE: 3,
  RING: 4,
  SQUARE: 5,
  DIAGONAL: 6,
  CONE: 7,
} as const;

export type ZoneShapeValue = typeof ZoneShape[keyof typeof ZoneShape];

/**
 * Spell definition attached to fighter entities.
 */
@component export class Spell {
  @field.uint16 declare id: number;
  @field.uint8 declare level: number;
  @field.uint8 declare position: number;
  @field.uint16 declare animationId: number;
}

/**
 * Spell casting costs and range requirements.
 */
@component export class SpellCost {
  @field.uint8 declare apCost: number;
  @field.uint8 declare minRange: number;
  @field.uint8 declare maxRange: number;
  @field.boolean declare lineOfSight: boolean;
  @field.boolean declare linearOnly: boolean;
  @field.boolean declare freeCell: boolean;
  @field.boolean declare modifiableRange: boolean;
}

/**
 * Spell cooldown and usage limits.
 */
@component export class SpellCooldown {
  @field.uint16 declare spellId: number;
  @field.uint8 declare turnsRemaining: number;
  @field.uint8 declare usesThisTurn: number;
  @field.uint8 declare maxUsesPerTurn: number;
  @field.uint8 declare maxUsesPerTarget: number;
  @field.uint8 declare globalCooldown: number;
}

/**
 * Spell area of effect zone.
 */
@component export class SpellZone {
  @field.uint8 declare shape: number;
  @field.uint8 declare minSize: number;
  @field.uint8 declare maxSize: number;
}

/**
 * Spell critical hit/failure chances.
 */
@component export class SpellCritical {
  @field.uint8 declare hitChance: number;
  @field.uint8 declare failureChance: number;
}

/**
 * Spell state requirements.
 * Required or forbidden states for casting.
 */
@component export class SpellStateRequirements {
  @field.object declare requiredStates: number[];
  @field.object declare forbiddenStates: number[];
}
