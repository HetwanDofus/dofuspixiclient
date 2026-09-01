import { describe, expect, test } from "bun:test";

import { jobPodsBonus } from "@modules/jobs/jobs.pods";

describe("jobPodsBonus", () => {
  test("no job is worth nothing", () => {
    expect(jobPodsBonus([])).toBe(0);
  });

  test("a fresh job is worth five pods", () => {
    expect(jobPodsBonus([1])).toBe(5);
  });

  test("scales at five per level", () => {
    expect(jobPodsBonus([40])).toBe(200);
    expect(jobPodsBonus([99])).toBe(495);
  });

  test("mastery is a step, not a slope — a job 100 is worth 1500", () => {
    expect(jobPodsBonus([100])).toBe(1500);
    expect(jobPodsBonus([99]) + 5).not.toBe(jobPodsBonus([100]));
  });

  test("jobs cumulate", () => {
    expect(jobPodsBonus([100, 100, 100])).toBe(4500);
    expect(jobPodsBonus([100, 40, 1])).toBe(1500 + 200 + 5);
  });

  test("ignores a level that is not one", () => {
    expect(jobPodsBonus([0, -3, 10])).toBe(50);
  });
});
