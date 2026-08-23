/**
 * The Dofus 1.29 baselines every character starts from, before breed,
 * level and equipment are taken into account.
 *
 * These used to be spread across the select-character slice and inline
 * literals in `StatsService`; they live here now that `StatsService` is
 * the only thing that derives an `AccountStats` frame. The fight engine
 * keeps its own copy of the AP/MP baseline in `Fighter.fromPlayer` —
 * that duplication is still open.
 */

/** Action points a character has before any bonus. */
export const BASE_AP = 6;
/** Movement points a character has before any bonus. */
export const BASE_MP = 3;
/** Summons a character may keep alive at once, before any bonus. */
export const BASE_MAX_SUMMONS = 1;
/** Prospection floor; chance adds to it. */
export const BASE_DISCERNMENT = 100;
/** Energy is a 0..10000 gauge in 1.29, not a 0..100 one. */
export const ENERGY_MAX = 10_000;

/**
 * Max life points: a flat 50, plus 5 per level, plus total vitality.
 *
 * `fight-start.service.ts` derives a fighter's life the same way and
 * points back here in a comment — the two must stay in step.
 */
export function maxLifePoints(level: number, totalVitality: number): number {
  return 50 + 5 * level + totalVitality;
}

/**
 * Prospection: the 100-point floor plus one point per ten points of
 * chance, base and equipment alike.
 *
 * This used to be inlined in `StatsService.sendStats` as the character
 * sheet's "discernment" figure and nothing else read it. The loot roll
 * needs the same number, and a second copy of the formula would let the
 * sheet and the actual drop rate drift apart silently — which is exactly
 * the kind of divergence a player reports as "the drop rate is lying".
 *
 * Note that item effect 74 (prospection gear) is not mapped in
 * `applyItemEffect` yet, so `equipChance` is the only equipment path
 * into this number today.
 */
export function prospection(baseChance: number, equipChance: number): number {
  return BASE_DISCERNMENT + Math.floor((baseChance + equipChance) / 10);
}
