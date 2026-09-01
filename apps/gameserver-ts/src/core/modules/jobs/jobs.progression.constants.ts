/**
 * The job level curve, in one place.
 *
 * Unlike the character curve — which `players.progression.constants.ts` still
 * approximates with a quadratic placeholder — this one is the real 1.29 table,
 * copied verbatim from StarLoco-Game's `scripts/data/Experience.lua`
 * (`JobLevelExp`, retrieved 2026-08-31). It is a hand-authored list, not a
 * formula: nothing here computes, and `jobs.progression.constants.spec.ts`
 * checks it against six independently published control points rather than
 * asking a reader to proofread a hundred numbers.
 *
 * `JOB_LEVEL_EXP[n - 1]` is the *cumulative* experience needed to be level `n`,
 * so level 1 costs 0 and level 100 costs 581 687. `player_jobs.experience` is
 * that running total, not a per-level counter.
 */
export const JOB_LEVEL_EXP: readonly number[] = [
  0, 50, 140, 271, 441, 653, 905, 1199, 1543, 1911, 2330, 2792, 3297, 3840,
  4439, 5078, 5762, 6493, 7280, 8097, 8980, 9898, 10875, 11903, 12985, 14122,
  15315, 16564, 17873, 19242, 20672, 22166, 23726, 25353, 27048, 28815, 30656,
  32572, 34566, 36641, 38800, 41044, 43378, 45804, 48325, 50946, 53669, 56498,
  59437, 62491, 65664, 68960, 72385, 75943, 79640, 83482, 87475, 91624, 95937,
  100421, 105082, 109930, 114971, 120215, 125671, 131348, 137256, 143407,
  149811, 156481, 163429, 170669, 178214, 186080, 194283, 202839, 211765,
  221082, 230808, 240964, 251574, 262660, 274248, 286364, 299037, 312297,
  326175, 340705, 355924, 371870, 388582, 406106, 424486, 443772, 464016,
  485274, 507604, 531071, 555541, 581687,
];

/** 1.29's hard ceiling for a job; the curve is not consulted past it. */
export const MAX_JOB_LEVEL = 100;

/** The level a freshly learned job starts at. */
export const MIN_JOB_LEVEL = 1;

/**
 * The level a job with `xp` banked has reached.
 *
 * A linear scan of a hundred entries is cheaper than the branch-heavy binary
 * search it would replace, and this runs once per harvest.
 */
export function jobLevelForXp(xp: number): number {
  let level = MIN_JOB_LEVEL;

  for (let i = 1; i < JOB_LEVEL_EXP.length; i++) {
    if (xp < (JOB_LEVEL_EXP[i] as number)) {
      break;
    }
    level = i + 1;
  }

  return level;
}

/**
 * The window the `JX` frame draws: where this level started, and where the
 * next one begins.
 *
 * At the ceiling the client would divide by zero on an empty window, so the
 * cap reports the last threshold as both bounds — which is what
 * `Job.get xpMax` guards against on its side with its `Math.pow(10, 17)` test.
 */
export function jobXpBounds(level: number): { min: number; max: number } {
  const clamped = Math.min(Math.max(level, MIN_JOB_LEVEL), MAX_JOB_LEVEL);
  const min = JOB_LEVEL_EXP[clamped - 1] as number;

  if (clamped >= MAX_JOB_LEVEL) {
    return { min, max: min };
  }

  return { min, max: JOB_LEVEL_EXP[clamped] as number };
}
