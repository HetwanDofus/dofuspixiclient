/**
 * The carrying capacity a character's jobs are worth.
 *
 * `modules/inventory/pods.ts` owns the rest of the formula
 * (`1000 + 5 × strength + effect 158`) and was written for QA-013, when no
 * job existed. This is the missing term, and it lives here rather than there
 * so the pods module keeps no opinion about jobs — see QA-133.
 *
 * 1.29 grants 5 pods per job level, and a flat 1 000 more on reaching 100:
 * a level-100 job is worth 1 500, not 500. Every job a character holds
 * contributes.
 */

/** Pods granted per level of a job. */
export const PODS_PER_JOB_LEVEL = 5;

/** The extra granted once, on reaching the ceiling. */
export const PODS_AT_JOB_MASTERY = 1000;

/** The level that unlocks the mastery bonus. */
const MASTERY_LEVEL = 100;

export function jobPodsBonus(levels: readonly number[]): number {
  let total = 0;

  for (const level of levels) {
    if (level <= 0) {
      continue;
    }
    total += PODS_PER_JOB_LEVEL * level;
    if (level >= MASTERY_LEVEL) {
      total += PODS_AT_JOB_MASTERY;
    }
  }

  return total;
}
