/**
 * How long a harvest takes and what it yields.
 *
 * Both formulas are StarLoco's, from `scripts/data/Skills.lua`
 * (`registerGatherJobSkills`), which is the only implementation of them the
 * project has access to. Neither is in a lang bundle or in `game.sql`, so
 * they are written here once, named, and pinned by `harvest.rules.spec.ts`
 * rather than being spread through the service as literals — that is the
 * whole point of QA-123's "no silent constant in the execution path".
 *
 * The one thing not taken from upstream is the floor. `12000 - 100 × gap`
 * goes to zero at a 120-level gap and negative beyond it; the gap cannot
 * exceed 99 in practice (level 100 on a level-1 resource, 2 100 ms), but a
 * duration is not something to leave depending on that. 400 ms is 1.29's
 * observed lower bound.
 */

/** What a harvest costs at no level advantage at all. */
export const BASE_HARVEST_MS = 12_000;

/** Shaved off per level of advantage over the skill's minimum. */
export const MS_PER_LEVEL_OF_ADVANTAGE = 100;

/** No action is ever shorter than this, whatever the gap. */
export const MIN_HARVEST_MS = 400;

/** Baseline yield before any level advantage. */
export const BASE_QUANTITY_SPREAD = 2;

/** One more possible unit per this many levels of advantage. */
export const LEVELS_PER_EXTRA_UNIT = 5;

/** How far past a skill's minimum level the character is; never negative. */
export function levelAdvantage(jobLevel: number, minLevel: number): number {
  return Math.max(0, jobLevel - minLevel);
}

export function harvestDuration(jobLevel: number, minLevel: number): number {
  const advantage = levelAdvantage(jobLevel, minLevel);

  return Math.max(
    MIN_HARVEST_MS,
    BASE_HARVEST_MS - MS_PER_LEVEL_OF_ADVANTAGE * advantage
  );
}

/**
 * How many units this attempt yields: `random(1, 2 + gap / 5)`.
 *
 * `random01` is injected rather than called here so the rule stays pure and
 * the service can be tested against a fixed roll.
 */
export function harvestQuantity(
  jobLevel: number,
  minLevel: number,
  random01: number
): number {
  const advantage = levelAdvantage(jobLevel, minLevel);
  const spread =
    BASE_QUANTITY_SPREAD + Math.floor(advantage / LEVELS_PER_EXTRA_UNIT);
  const clamped = Math.min(Math.max(random01, 0), 0.999_999_999);

  return 1 + Math.floor(clamped * spread);
}
