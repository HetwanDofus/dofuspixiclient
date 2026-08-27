import type { BoostableStat } from "@modules/stats/boost-cost";
import {
  SPELL_POINTS_PER_LEVEL,
  STAT_POINTS_PER_LEVEL,
} from "@modules/players/players.progression.constants";
import { spellUpgradeCost } from "@modules/spells/spell-upgrade-cost";
import { boostCost } from "@modules/stats/boost-cost";

/**
 * What a character's two capital balances *should* be at a given level.
 *
 * Capital is normally a running balance: `grantLevels` credits it, the
 * boost and upgrade handlers debit it, and nothing recomputes it. That
 * works as long as every level was actually granted by the game — and
 * in this project none of them are: levels get set by hand in SQL, the
 * credit is forgotten (or half-remembered — the dev character had its
 * 381 characteristic points and 2 of its 97 spell points), and the
 * character can no longer spend what it earned.
 *
 * So this derives the balance instead of tracking it: everything the
 * levels earned, minus everything the current characteristics and spell
 * levels cost to buy. Being an *assignment* rather than an increment,
 * applying it twice is a no-op — which is what makes it safe to run
 * against a character whose history is unknown.
 *
 * The assumption it rests on, and the reason this is a repair tool and
 * not something on the login path: levels are the only source of
 * capital, and boosts and spell upgrades are its only sinks. Add a
 * source that is not a level — 1.29's own characteristic reset gives
 * capital back — and a recompute would quietly erase it.
 */
export interface ExpectedCapital {
  statsPoints: number;
  spellPoints: number;
  statsSpent: number;
  spellsSpent: number;
}

export function expectedCapital(input: {
  classId: number;
  level: number;
  stats: Record<BoostableStat, number>;
  spellLevels: readonly number[];
}): ExpectedCapital {
  const { classId, level, stats, spellLevels } = input;

  const levelsGained = Math.max(0, level - 1);
  const statsSpent = capitalSpentOnStats(classId, stats);
  const spellsSpent = capitalSpentOnSpells(spellLevels);

  return {
    statsPoints: levelsGained * STAT_POINTS_PER_LEVEL - statsSpent,
    spellPoints: levelsGained * SPELL_POINTS_PER_LEVEL - spellsSpent,
    statsSpent,
    spellsSpent,
  };
}

/**
 * Capital it takes to buy `stats` from scratch, walking the per-breed
 * price tiers one point at a time — the same walk the boost handler
 * charges for, so the two cannot disagree about what a characteristic
 * was worth.
 */
export function capitalSpentOnStats(
  classId: number,
  stats: Record<BoostableStat, number>
): number {
  let total = 0;

  for (const [stat, value] of Object.entries(stats) as [
    BoostableStat,
    number,
  ][]) {
    for (let base = 0; base < value; base++) {
      total += boostCost(classId, stat, base);
    }
  }

  return total;
}

/** Capital it takes to raise each spell from level 1 to its level. */
export function capitalSpentOnSpells(spellLevels: readonly number[]): number {
  let total = 0;

  for (const level of spellLevels) {
    for (let from = 1; from < level; from++) {
      total += spellUpgradeCost(from);
    }
  }

  return total;
}
