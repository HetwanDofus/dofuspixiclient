/**
 * Spell points it costs to raise a spell from `currentLevel` to the
 * next one. Dofus 1.29's curve is the level you are leaving: 1→2 costs
 * 1, 2→3 costs 2, … 5→6 costs 5, for 15 points to max a spell.
 *
 * The client mirrors this in `apps/electrobun/src/game/stores/spells-store.ts`
 * to render "Coût du niveau suivant : N" and gate the `+` button; this
 * copy is the authority — the upgrade handler charges against it.
 */
export function spellUpgradeCost(currentLevel: number): number {
  return Math.max(1, currentLevel);
}

/** Highest level any spell can reach. */
export const MAX_SPELL_LEVEL = 6;
