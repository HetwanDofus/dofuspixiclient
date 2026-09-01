/**
 * How many ingredient slots a craft skill offers at a given job level.
 *
 * This is the one rule of the jobs system with **no upstream source**. It is
 * in no lang bundle and in no dump column; StarLoco's own scripts compute
 * `level / 20 + 4`, which gives five slots at level 20 where 1.29 gives four,
 * so they are not it either. What is written here is the published 1.29
 * ladder, and it is a step function, not a slope: a slot is gained at 10, 20,
 * 40, 60, 80 and 100, and nowhere else.
 *
 * The full craft rules — success rate and experience by slot count — are
 * QA-136 and land with the workshop. Only the slot count is needed before
 * then, because `JS` carries it (`param1`) and the 1.29 client filters its
 * recipe list on it the moment a job is learned.
 */

/** `[minimum job level, slots]`, highest first. */
const LADDER: readonly [level: number, slots: number][] = [
  [100, 8],
  [80, 7],
  [60, 6],
  [40, 5],
  [20, 4],
  [10, 3],
  [1, 2],
];

export function craftSlotsAtLevel(jobLevel: number): number {
  for (const [level, slots] of LADDER) {
    if (jobLevel >= level) {
      return slots;
    }
  }

  return 0;
}
