/**
 * The level curve, in one place.
 *
 * `xpForLevel(n)` is the *cumulative* experience a character must have
 * banked to be level `n` — `players.experience` is a running total, not
 * a per-level counter. The quadratic below is this project's placeholder
 * for the retail 1.29 table (which is a hand-authored list, not a
 * formula); it was written out twice, in `FightEndService` and in
 * `StatsService`, and the two agreed only by luck. Both read it here now,
 * so replacing it with the real table is a one-file change.
 */
export function xpForLevel(level: number): number {
  return level * level * 10;
}

/** Cumulative experience needed to reach the level above `level`. */
export function xpForNextLevel(level: number): number {
  return xpForLevel(level + 1);
}

/** 1.29's hard ceiling; the curve is not consulted past it. */
export const MAX_LEVEL = 200;

/** Characteristic points granted per level. */
export const STAT_POINTS_PER_LEVEL = 5;

/** Spell points ("capital sorts") granted per level. */
export const SPELL_POINTS_PER_LEVEL = 1;
