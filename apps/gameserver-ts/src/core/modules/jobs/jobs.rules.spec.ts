import { describe, expect, test } from "bun:test";

import type { HeldJob } from "@modules/jobs/jobs.rules";
import { BASE_JOB_ID, canLearn } from "@modules/jobs/jobs.rules";

const LUMBERJACK = { jobId: 2, specializationOf: 0 };
const MINER = { jobId: 24, specializationOf: 0 };
const FARMER = { jobId: 28, specializationOf: 0 };
const ALCHEMIST = { jobId: 26, specializationOf: 0 };
/** Joaillomage — the magus specialisation of Bijoutier (16). */
const JEWEL_MAGUS = { jobId: 63, specializationOf: 16 };

function held(...jobs: [number, number, number?][]): HeldJob[] {
  return jobs.map(([jobId, level, specializationOf]) => ({
    jobId,
    level,
    specializationOf: specializationOf ?? 0,
  }));
}

describe("canLearn — ordinary jobs", () => {
  test("the first job is free", () => {
    expect(canLearn({ candidate: LUMBERJACK, held: [] })).toEqual({ ok: true });
  });

  test("a second job needs the first at 30", () => {
    expect(canLearn({ candidate: MINER, held: held([2, 29]) })).toEqual({
      ok: false,
      reason: "another-job-too-low",
    });
    expect(canLearn({ candidate: MINER, held: held([2, 30]) })).toEqual({
      ok: true,
    });
  });

  test("a fourth job has no slot, whatever the levels", () => {
    expect(
      canLearn({
        candidate: ALCHEMIST,
        held: held([2, 100], [24, 100], [28, 100]),
      })
    ).toEqual({ ok: false, reason: "no-slot-left" });
  });

  test("a job already known is refused as such, not as a missing slot", () => {
    expect(canLearn({ candidate: LUMBERJACK, held: held([2, 1]) })).toEqual({
      ok: false,
      reason: "already-known",
    });
  });

  test("`-Base-` is not a job and never occupies a slot", () => {
    expect(
      canLearn({
        candidate: { jobId: BASE_JOB_ID, specializationOf: 0 },
        held: [],
      })
    ).toEqual({ ok: false, reason: "not-learnable" });

    // Holding it must not consume one of the three either.
    expect(
      canLearn({
        candidate: FARMER,
        held: held([BASE_JOB_ID, 1], [2, 30], [24, 30]),
      })
    ).toEqual({ ok: true });
  });

  test("an unknown job id is refused rather than assumed ordinary", () => {
    expect(canLearn({ candidate: null, held: [] })).toEqual({
      ok: false,
      reason: "not-learnable",
    });
  });
});

describe("canLearn — magus specialisations", () => {
  test("needs the parent job at 65", () => {
    expect(canLearn({ candidate: JEWEL_MAGUS, held: held([16, 64]) })).toEqual({
      ok: false,
      reason: "parent-job-too-low",
    });
    expect(canLearn({ candidate: JEWEL_MAGUS, held: held([16, 65]) })).toEqual({
      ok: true,
    });
  });

  test("without the parent job at all", () => {
    expect(canLearn({ candidate: JEWEL_MAGUS, held: held([2, 100]) })).toEqual({
      ok: false,
      reason: "parent-job-too-low",
    });
  });

  test("does not take an ordinary slot", () => {
    expect(
      canLearn({
        candidate: JEWEL_MAGUS,
        held: held([16, 65], [2, 30], [24, 30]),
      })
    ).toEqual({ ok: true });
  });

  test("but the level-30 rule counts both families", () => {
    expect(
      canLearn({
        candidate: { jobId: 62, specializationOf: 15 },
        held: held([16, 65], [15, 65], [63, 10, 16]),
      })
    ).toEqual({ ok: false, reason: "another-job-too-low" });
  });

  test("a fourth specialisation has no slot", () => {
    expect(
      canLearn({
        candidate: { jobId: 64, specializationOf: 27 },
        held: held(
          [27, 100],
          [63, 30, 16],
          [62, 30, 15],
          [44, 30, 11],
          [16, 100],
          [15, 100]
        ),
      })
    ).toEqual({ ok: false, reason: "no-slot-left" });
  });
});
