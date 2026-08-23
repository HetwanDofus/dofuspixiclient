/**
 * Dofus 1.29 characteristic boost costs, per breed.
 *
 * Each entry is `[threshold, cost]`: while the characteristic's *base*
 * value is below `threshold`, one point of the characteristic costs
 * `cost` points of capital. Entries are ordered ascending and the last
 * one is always `Infinity`.
 *
 * This is the authority — the panel keeps its own copy
 * (`apps/electrobun/src/hud/stats/boost-costs.ts`) purely to decide
 * whether to draw the `+` button, exactly as the spell book mirrors
 * `spellUpgradeCost`. Keep the two tables in step.
 */

/**
 * The six boostable characteristics, named rather than numbered: three
 * incompatible id spaces exist for them (the panel's STAT_IDS 0-5, the
 * `AccountUseBoost.stat_id` wire values 10-15, and the fight engine's
 * `Characteristic` map), and the column names are the only labels that
 * mean the same thing everywhere.
 */
export type BoostableStat =
  | "strength"
  | "vitality"
  | "wisdom"
  | "chance"
  | "agility"
  | "intelligence";

type CostEntry = [number, number];

const BOOST_COSTS: Record<number, Record<BoostableStat, CostEntry[]>> = {
  // Feca (1)
  1: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    chance: [
      [20, 1],
      [40, 2],
      [60, 3],
      [80, 4],
      [Infinity, 5],
    ],
    agility: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
  // Osamodas (2)
  2: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    chance: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    agility: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
  // Enutrof (3)
  3: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [50, 1],
      [150, 2],
      [250, 3],
      [350, 4],
      [Infinity, 5],
    ],
    chance: [
      [100, 1],
      [150, 2],
      [230, 3],
      [330, 4],
      [Infinity, 5],
    ],
    agility: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [20, 1],
      [60, 2],
      [100, 3],
      [140, 4],
      [Infinity, 5],
    ],
  },
  // Sram (4)
  4: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    chance: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    agility: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
  },
  // Xelor (5)
  5: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    chance: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    agility: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
  // Ecaflip (6)
  6: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    chance: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    agility: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
  },
  // Eniripsa (7)
  7: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    chance: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    agility: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
  // Iop (8)
  8: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    chance: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    agility: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
  },
  // Cra (9)
  9: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    chance: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    agility: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
  },
  // Sadida (10)
  10: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    chance: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    agility: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
  // Sacrieur (11)
  11: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [100, 3],
      [200, 4],
      [Infinity, 5],
    ],
    chance: [
      [100, 3],
      [200, 4],
      [Infinity, 5],
    ],
    agility: [
      [100, 3],
      [200, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [100, 3],
      [200, 4],
      [Infinity, 5],
    ],
  },
  // Pandawa (12)
  12: {
    vitality: [[Infinity, 1]],
    wisdom: [[Infinity, 3]],
    strength: [
      [50, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    chance: [
      [50, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    agility: [
      [50, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    intelligence: [
      [50, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
};

/**
 * What one point of `stat` costs a `classId` character whose current
 * base value is `currentBase`.
 *
 * An unknown breed or characteristic falls back to 5 — the most
 * expensive tier — so a bad id can never be exploited into a cheap
 * boost.
 */
export function boostCost(
  classId: number,
  stat: BoostableStat,
  currentBase: number
): number {
  const entries = BOOST_COSTS[classId]?.[stat];
  if (!entries) {
    return 5;
  }
  for (const [threshold, cost] of entries) {
    if (currentBase < threshold) {
      return cost;
    }
  }
  return 5;
}
