import type { MonsterDropRow } from "@shared/db/schema";

/**
 * Rolling the loot of a won fight.
 *
 * Kept as pure functions, deliberately: the roll is the part that is
 * hard to observe in play (five fights without a drop prove nothing) and
 * easy to check in a test. `FightEndService` supplies the database rows,
 * the prospection and the challenge bonus, and persists whatever comes
 * back.
 *
 * `monster_drops.rate` is a **percentage**, a double — the world
 * importer writes StarLoco's `percentGradeN` straight through, and
 * collapses the five per-grade rates onto one. Do not read it as a
 * 0..1 probability.
 */

/** The 1.29 prospection floor a character has with zero chance. */
const BASELINE_PROSPECTION = 100;

export interface LootRoll {
  /** Template of the item won. */
  templateId: number;
  quantity: number;
}

export interface LootInput {
  /** Drop table rows for every monster the team defeated. */
  drops: readonly MonsterDropRow[];
  /** Winner's prospection, as `stats.constants.prospection()` returns it. */
  prospection: number;
  /** Extra drop percentage won from fight challenges, e.g. 50 for +50%. */
  challengeBonusPct: number;
}

/**
 * Roll one winner's share of the loot.
 *
 * Every drop line is an independent draw — a monster with three lines
 * can yield all three, or none. The chance of a line is its rate scaled
 * by how far the winner's prospection sits above the 100-point baseline,
 * then by the challenge bonus:
 *
 *   chance% = rate × (prospection / 100) × (1 + bonus/100)
 *
 * A rate of zero never drops however much prospection is stacked, and a
 * chance above 100 always drops — both properties the tests pin down,
 * because getting either wrong is invisible in play for a long while.
 */
export function rollLoot(
  input: LootInput,
  random: () => number = Math.random
): LootRoll[] {
  const won: LootRoll[] = [];

  const prospectionFactor =
    Math.max(0, input.prospection) / BASELINE_PROSPECTION;
  const bonusFactor = (100 + input.challengeBonusPct) / 100;

  for (const drop of input.drops) {
    if (drop.rate <= 0) {
      continue;
    }

    const chance = drop.rate * prospectionFactor * bonusFactor;

    if (random() * 100 >= chance) {
      continue;
    }

    won.push({
      templateId: drop.itemTemplateId,
      quantity: rollQuantity(drop, random),
    });
  }

  return won;
}

/**
 * Quantity for one won line.
 *
 * The importer currently pins `minQuantity` and `maxQuantity` to 1
 * (`import-starloco-content.ts`), so this is a no-op on today's data —
 * but the columns are real and a later import pass will populate them,
 * and hardcoding 1 here would then be a silent bug rather than a visible
 * one.
 */
function rollQuantity(drop: MonsterDropRow, random: () => number): number {
  const min = Math.max(1, drop.minQuantity);
  const max = Math.max(min, drop.maxQuantity);

  if (max === min) {
    return min;
  }

  return min + Math.floor(random() * (max - min + 1));
}
