import { describe, expect, test } from "bun:test";

import {
  JOB_LEVEL_EXP,
  jobLevelForXp,
  jobXpBounds,
  MAX_JOB_LEVEL,
} from "@modules/jobs/jobs.progression.constants";

/**
 * Six published thresholds, from the 1.29 profession tables. The table is
 * transcribed rather than derived, so these are the only defence against a
 * digit lost in the copy — proofreading a hundred numbers by eye is not one.
 */
const CONTROL_POINTS: readonly [level: number, cumulative: number][] = [
  [10, 1911],
  [30, 19_242],
  [60, 100_421],
  [65, 125_671],
  [80, 240_964],
  [100, 581_687],
];

describe("JOB_LEVEL_EXP", () => {
  test("has one entry per job level", () => {
    expect(JOB_LEVEL_EXP).toHaveLength(MAX_JOB_LEVEL);
  });

  test("starts at zero — level 1 is free", () => {
    expect(JOB_LEVEL_EXP[0]).toBe(0);
  });

  test("is strictly increasing", () => {
    for (let i = 1; i < JOB_LEVEL_EXP.length; i++) {
      expect(JOB_LEVEL_EXP[i]).toBeGreaterThan(JOB_LEVEL_EXP[i - 1] as number);
    }
  });

  for (const [level, cumulative] of CONTROL_POINTS) {
    test(`level ${level} costs ${cumulative}`, () => {
      expect(JOB_LEVEL_EXP[level - 1]).toBe(cumulative);
    });
  }
});

describe("jobLevelForXp", () => {
  test("a fresh job is level 1", () => {
    expect(jobLevelForXp(0)).toBe(1);
  });

  test("one experience short of a threshold is still the level below", () => {
    expect(jobLevelForXp(1910)).toBe(9);
    expect(jobLevelForXp(1911)).toBe(10);
  });

  test("the ceiling holds", () => {
    expect(jobLevelForXp(581_687)).toBe(100);
    expect(jobLevelForXp(10_000_000)).toBe(100);
  });

  test("agrees with the table at every level", () => {
    for (let level = 1; level <= MAX_JOB_LEVEL; level++) {
      expect(jobLevelForXp(JOB_LEVEL_EXP[level - 1] as number)).toBe(level);
    }
  });
});

describe("jobXpBounds", () => {
  test("frames the current level", () => {
    expect(jobXpBounds(10)).toEqual({ min: 1911, max: 2330 });
  });

  test("collapses at the ceiling rather than reporting an empty window", () => {
    expect(jobXpBounds(100)).toEqual({ min: 581_687, max: 581_687 });
  });

  test("clamps out-of-range levels instead of reading past the table", () => {
    expect(jobXpBounds(0)).toEqual(jobXpBounds(1));
    expect(jobXpBounds(500)).toEqual(jobXpBounds(100));
  });
});
