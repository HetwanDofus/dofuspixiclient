/**
 * Dofus 1.29 boost cost tables per class.
 * Each entry: [threshold, cost] — below threshold, costs `cost` capital points per +1 stat.
 */
type CostEntry = [number, number];

const BOOST_COSTS: Record<number, Record<number, CostEntry[]>> = {
  // Feca (1)
  1: {
    0: [[Infinity, 1]], // Vitality
    1: [[Infinity, 3]], // Wisdom
    2: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ], // Strength
    3: [
      [20, 1],
      [40, 2],
      [60, 3],
      [80, 4],
      [Infinity, 5],
    ], // Chance
    4: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ], // Agility
    5: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ], // Intelligence
  },
  // Osamodas (2)
  2: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    3: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    4: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    5: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
  // Enutrof (3)
  3: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [50, 1],
      [150, 2],
      [250, 3],
      [350, 4],
      [Infinity, 5],
    ],
    3: [
      [100, 1],
      [150, 2],
      [230, 3],
      [330, 4],
      [Infinity, 5],
    ],
    4: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    5: [
      [20, 1],
      [60, 2],
      [100, 3],
      [140, 4],
      [Infinity, 5],
    ],
  },
  // Sram (4)
  4: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    3: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    4: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    5: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
  },
  // Xelor (5)
  5: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    3: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    4: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    5: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
  // Ecaflip (6)
  6: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    3: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    4: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    5: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
  },
  // Eniripsa (7)
  7: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    3: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    4: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    5: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
  // Iop (8)
  8: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    3: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    4: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    5: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
  },
  // Cra (9)
  9: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    3: [
      [20, 2],
      [40, 3],
      [60, 4],
      [Infinity, 5],
    ],
    4: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    5: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
  },
  // Sadida (10)
  10: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    3: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    4: [
      [50, 2],
      [150, 3],
      [250, 4],
      [Infinity, 5],
    ],
    5: [
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
  // Sacrieur (11)
  11: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [100, 3],
      [200, 4],
      [Infinity, 5],
    ],
    3: [
      [100, 3],
      [200, 4],
      [Infinity, 5],
    ],
    4: [
      [100, 3],
      [200, 4],
      [Infinity, 5],
    ],
    5: [
      [100, 3],
      [200, 4],
      [Infinity, 5],
    ],
  },
  // Pandawa (12)
  12: {
    0: [[Infinity, 1]],
    1: [[Infinity, 3]],
    2: [
      [50, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    3: [
      [50, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    4: [
      [50, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
    5: [
      [50, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [Infinity, 5],
    ],
  },
};

export function getBoostCost(
  classId: number,
  statId: number,
  currentBase: number
): number {
  const classCosts = BOOST_COSTS[classId];

  if (!classCosts) {
    return 5;
  }

  const entries = classCosts[statId];

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
