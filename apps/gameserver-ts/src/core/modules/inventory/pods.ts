/**
 * Carrying capacity ("pods").
 *
 * Nothing computed this before: `item_templates.weight` was imported and
 * read by no one, and the `ItemWeight` (`Ow`) frame was never emitted —
 * the client's inventory store already handled it and just never received
 * one, which is why QA-013 always showed a hardcoded 450/1000.
 *
 * Retail 1.29's formula is `1000 + 5 × strength + effect 445`, but the
 * effect id that grants bonus pods in this project's extracted
 * `effects.json` is **158** ("Augmente le poids portable de …"), with 159
 * as its negative counterpart — 445 does not appear there. `strength` is
 * the character's *total* strength (base + equipment), matching how every
 * other total in `StatsService.sendStats` (initiative, prospection) is
 * built from base + equip.
 */

/** Base carrying capacity before strength or any pods effect. */
export const BASE_PODS = 1000;

/** Pods granted per point of total strength. */
export const PODS_PER_STRENGTH = 5;

export function maxPods(totalStrength: number, podsBonus: number): number {
  return BASE_PODS + PODS_PER_STRENGTH * totalStrength + podsBonus;
}

export interface WeighableItem {
  templateId: number;
  quantity: number;
}

/**
 * Total weight of every item a character owns — bag *and* equipped alike,
 * exactly as 1.29 counts it (equipping something does not lighten the bag).
 *
 * `weightByTemplate` is a lookup the caller builds once per player from
 * `ItemTemplateCacheService`, so this stays a pure sum with no I/O of its
 * own and is trivial to unit test.
 */
export function currentPods(
  items: readonly WeighableItem[],
  weightByTemplate: ReadonlyMap<number, number>
): number {
  let total = 0;
  for (const item of items) {
    total += item.quantity * (weightByTemplate.get(item.templateId) ?? 0);
  }
  return total;
}
