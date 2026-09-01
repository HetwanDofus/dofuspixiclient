import { describe, expect, test } from "bun:test";

import { craftSlotsAtLevel } from "@modules/jobs/jobs.craft-slots";

describe("craftSlotsAtLevel", () => {
  test.each([
    [1, 2],
    [10, 3],
    [20, 4],
    [40, 5],
    [60, 6],
    [80, 7],
    [100, 8],
  ])("level %i offers %i slots", (level, slots) => {
    expect(craftSlotsAtLevel(level)).toBe(slots);
  });

  test("gains happen at the threshold, not before", () => {
    expect(craftSlotsAtLevel(9)).toBe(2);
    expect(craftSlotsAtLevel(19)).toBe(3);
    expect(craftSlotsAtLevel(39)).toBe(4);
    expect(craftSlotsAtLevel(59)).toBe(5);
    expect(craftSlotsAtLevel(79)).toBe(6);
    expect(craftSlotsAtLevel(99)).toBe(7);
  });

  test("is a step function — no slot is gained per ten levels", () => {
    expect(craftSlotsAtLevel(30)).toBe(craftSlotsAtLevel(20));
    expect(craftSlotsAtLevel(50)).toBe(craftSlotsAtLevel(40));
    expect(craftSlotsAtLevel(70)).toBe(craftSlotsAtLevel(60));
  });

  test("a job below level 1 offers none", () => {
    expect(craftSlotsAtLevel(0)).toBe(0);
  });
});
