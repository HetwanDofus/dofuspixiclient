import type { Fighter } from "../core/fight.fighter";

export const TargetMask = {
  None: 0,
  Enemy: 1,
  Ally: 2,
  Self: 4,
  EmptyCell: 8,
  /** Default for damage / debuff handlers — enemies only. */
  EnemiesOnly: 1,
  /** Default for heal / buff handlers — allies + caster. */
  AlliesAndSelf: 2 | 4,
  /** Default for self-only effects. */
  SelfOnly: 4,
  /** Default for trap/glyph placement — needs an empty cell. */
  EmptyOnly: 8,
  /** Permissive default — any fighter, no filter. */
  AnyFighter: 1 | 2 | 4,
} as const;

export type TargetMaskValue = (typeof TargetMask)[keyof typeof TargetMask];

export function isValidTarget(
  mask: number,
  caster: Fighter,
  target: Fighter | null
): boolean {
  // Mask of 0 means "no filter declared" — fall back to permissive
  // (the existing pre-mask behavior). We only enforce when the data
  // actually carries a non-zero filter.
  if (mask === 0) {
    return true;
  }
  if (!target) {
    return (mask & TargetMask.EmptyCell) !== 0;
  }
  if (target.id === caster.id) {
    return (mask & TargetMask.Self) !== 0;
  }
  const sameSide =
    !!caster.team &&
    !!target.team &&
    caster.team.side === target.team.side;
  if (sameSide) {
    return (mask & TargetMask.Ally) !== 0;
  }
  return (mask & TargetMask.Enemy) !== 0;
}

/**
 * Parse the optional FT=N filter expression carried in a spell
 * effect's `param` string. Maps the numeric Dofus filter codes to
 * a TargetMask. Returns null if no FT= directive present.
 *
 * FT codes (Arakne / StarLoco convention):
 *   1 = enemies only
 *   2 = allies (excl. self)
 *   3 = enemies + allies (excl. self)
 *   4 = self only
 *   5 = enemies + self
 *   6 = allies + self
 *   7 = anyone (default)
 */
export function parseTargetParam(param: string): number | null {
  if (!param) {
    return null;
  }
  const match = param.match(/FT=(\d+)/);
  if (!match) {
    return null;
  }
  const code = Number.parseInt(match[1] ?? "", 10);
  switch (code) {
    case 1:
      return TargetMask.Enemy;
    case 2:
      return TargetMask.Ally;
    case 3:
      return TargetMask.Enemy | TargetMask.Ally;
    case 4:
      return TargetMask.Self;
    case 5:
      return TargetMask.Enemy | TargetMask.Self;
    case 6:
      return TargetMask.Ally | TargetMask.Self;
    case 7:
      return TargetMask.Enemy | TargetMask.Ally | TargetMask.Self;
    default:
      return null;
  }
}
