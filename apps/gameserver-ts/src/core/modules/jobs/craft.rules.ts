import { craftSlotsAtLevel } from "@modules/jobs/jobs.craft-slots";

/**
 * What a craft costs, grants and risks — the 1.29 artisan rules.
 *
 * **This file has no upstream source, and that is deliberate.** Every other
 * number in the jobs system was imported or transcribed: the harvest levels
 * and experience come from StarLoco's scripts, the respawn delays from
 * `interactive_objects_data`, the recipes from `crafts.json`. These do not
 * exist in any of them. StarLoco does compute a slot count —
 * `ingredientsForCraftJob` returns `level / 20 + 4` — but it gives **five
 * slots at level 20 where 1.29 gives four**, so it is not the rule either; it
 * is a 1.39-era approximation. What is written here is the published 1.29
 * ladder, and `craft.rules.spec.ts` is the only thing standing between it and
 * a plausible-looking mistake.
 *
 * Two facts drive everything else, and both compare the recipe's size to what
 * the character can hold:
 *
 *  - **experience** is granted only from `maxSlots - 3` ingredients up. Below
 *    that the recipe is "grey" and worth nothing, which is what stops a
 *    level-100 artisan farming two-ingredient recipes;
 *  - **success is certain** at `maxSlots - 2` and below. 1.29 still displays
 *    99 % there, because it never shows 100.
 */

export { craftSlotsAtLevel };

/**
 * Experience for a successful *or failed* craft, by the recipe's ingredient
 * count. The index is the count, so slot 0 is unused.
 */
const XP_BY_SLOT_COUNT: readonly number[] = [
  0, 1, 10, 25, 50, 100, 250, 500, 1000,
];

/** How far below the ceiling a recipe may be and still pay. */
const XP_REACH = 3;

/** How far below the ceiling a recipe is guaranteed. */
const CERTAIN_REACH = 2;

/** The lowest success rate, at level 1. */
export const MIN_SUCCESS_RATE = 50;

/** The highest, at level 100 — 1.29 never shows 100. */
export const MAX_SUCCESS_RATE = 99;

/** What the interface prints for a craft that cannot fail. */
export const DISPLAYED_CERTAIN_RATE = 99;

/**
 * "Egrener" — the Paysan's husking. It never fails, at any level: it is a
 * conversion, not a fabrication.
 */
export const SKILL_HUSKING = 122;

/** "Polir une Pierre" — the Mineur's polishing, which opens at level 40. */
export const SKILL_STONE_POLISHING = 48;
export const STONE_POLISHING_LEVEL = 40;

/** How a recipe reads in the list, and what each colour promises. */
export type CraftDifficulty =
  /** Certain, and worth no experience. */
  | "grey"
  /** Certain, and worth experience. */
  | "green"
  /** Can fail, and worth experience. */
  | "red";

export interface CraftContext {
  jobLevel: number;
  skillId: number;
  /** How many ingredient slots the recipe fills. */
  ingredientCount: number;
}

/** Whether the character's level opens this skill at all. */
export function isSkillUnlocked(skillId: number, jobLevel: number): boolean {
  if (skillId === SKILL_STONE_POLISHING) {
    return jobLevel >= STONE_POLISHING_LEVEL;
  }

  return jobLevel >= 1;
}

/** Whether the recipe fits in the character's grid at all. */
export function fitsInGrid({
  jobLevel,
  ingredientCount,
}: Pick<CraftContext, "jobLevel" | "ingredientCount">): boolean {
  return ingredientCount >= 1 && ingredientCount <= craftSlotsAtLevel(jobLevel);
}

/**
 * Experience for one attempt — granted on a failure too.
 *
 * That is not a bug and it is worth stating twice: 1.29 consumes the
 * ingredients and pays the experience whether or not the object comes out.
 * A "fix" that withheld it would silently halve every artisan's progress.
 */
export function craftExperience({
  jobLevel,
  ingredientCount,
}: Pick<CraftContext, "jobLevel" | "ingredientCount">): number {
  const maxSlots = craftSlotsAtLevel(jobLevel);

  if (ingredientCount < 1 || ingredientCount > maxSlots) {
    return 0;
  }

  if (ingredientCount < maxSlots - XP_REACH) {
    return 0;
  }

  return XP_BY_SLOT_COUNT[ingredientCount] ?? 0;
}

/**
 * The base rate a craft succeeds at, before the certainty rule.
 *
 * StarLoco's own curve, which *is* consistent with 1.29's 50-at-1 to
 * 99-at-100: flat 50 below level 10, then five points per ten levels, then
 * 99 at the ceiling. The division is deliberately not integer — level 99
 * lands on 98.5, and rounding it up to 99 would make the last level free.
 */
export function baseSuccessRate(jobLevel: number): number {
  if (jobLevel >= 100) {
    return MAX_SUCCESS_RATE;
  }

  if (jobLevel < 10) {
    return MIN_SUCCESS_RATE;
  }

  return 54 + (jobLevel / 10 - 1) * 5;
}

/** Whether this recipe cannot fail for this character. */
export function isCertain({
  jobLevel,
  skillId,
  ingredientCount,
}: CraftContext): boolean {
  if (skillId === SKILL_HUSKING) {
    return true;
  }

  return ingredientCount <= craftSlotsAtLevel(jobLevel) - CERTAIN_REACH;
}

/** The real chance, certainty included. */
export function successRate(context: CraftContext): number {
  return isCertain(context) ? 100 : baseSuccessRate(context.jobLevel);
}

/** What the window prints — 1.29 shows 99 for a craft that cannot fail. */
export function displayedSuccessRate(context: CraftContext): number {
  return isCertain(context)
    ? DISPLAYED_CERTAIN_RATE
    : Math.floor(baseSuccessRate(context.jobLevel));
}

/**
 * The colour of the recipe's row.
 *
 * `dofus.datacenter.Craft` derives its own `difficulty` from
 * `itemsCount < param1 - 4` and `< param1 - 2`, which puts the grey boundary
 * one slot lower than the experience rule above. Ours is derived from the two
 * predicates that actually decide something — does it pay, can it fail — so
 * a grey row means "worth nothing" and never merely "easy".
 */
export function craftDifficulty(context: CraftContext): CraftDifficulty {
  const pays = craftExperience(context) > 0;

  if (!pays) {
    return "grey";
  }

  return isCertain(context) ? "green" : "red";
}

/**
 * Rolls one attempt. `random01` is injected so the rule stays pure and the
 * flow can be tested against a fixed roll.
 */
export function rollCraft(context: CraftContext, random01: number): boolean {
  return random01 * 100 < successRate(context);
}
