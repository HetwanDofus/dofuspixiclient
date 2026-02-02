import { component, field } from '@lastolivegames/becsy';

/**
 * Movement animation type constants.
 */
export const MoveAnimation = {
  WALK: 0,
  RUN: 1,
  SLIDE: 2,
} as const;

export type MoveAnimationValue = typeof MoveAnimation[keyof typeof MoveAnimation];

/**
 * Movement path for fighter animation.
 * Tracks the cells to traverse during movement.
 */
@component export class MovementPath {
  @field.object declare path: number[];
  @field.uint8 declare currentStep: number;
  @field.float32 declare progress: number;
  @field.uint8 declare animationType: number;
}

/**
 * Movement restriction flags.
 * Used during combat to enforce MP limits.
 */
@component export class MovementRestriction {
  @field.uint8 declare mpCost: number;
  @field.boolean declare inCombat: boolean;
  @field.boolean declare blocked: boolean;
}

/**
 * Push/Pull movement effect.
 * Tracks forced movement during spell effects.
 */
@component export class ForcedMovement {
  @field.uint16 declare targetCellId: number;
  @field.uint8 declare distance: number;
  @field.uint8 declare direction: number;
  @field.boolean declare isPush: boolean;
}

/**
 * Teleport effect.
 * Instant position change without path animation.
 */
@component export class TeleportTarget {
  @field.uint16 declare targetCellId: number;
  @field.boolean declare pending: boolean;
}
