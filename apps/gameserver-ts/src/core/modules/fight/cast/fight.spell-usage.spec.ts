import { beforeEach, describe, expect, test } from "bun:test";

import { SpellUsageTracker } from "@modules/fight/cast/fight.spell-usage";

describe("SpellUsageTracker", () => {
  let tracker: SpellUsageTracker;

  beforeEach(() => {
    tracker = new SpellUsageTracker();
  });

  test("canCast returns true when no limits", () => {
    const result = tracker.canCast(1, 100, 2, 0, 0);
    expect(result).toBe(true);
  });

  test("canCast returns true under perTurn limit", () => {
    tracker.recordCast(1, 100, 2);
    const result = tracker.canCast(1, 100, 2, 5, 0);
    expect(result).toBe(true);
  });

  test("canCast returns false when perTurn limit reached", () => {
    tracker.recordCast(1, 100, 2);
    tracker.recordCast(1, 100, 2);
    const result = tracker.canCast(1, 100, 2, 2, 0);
    expect(result).toBe(false);
  });

  test("canCast returns true under perTarget limit", () => {
    tracker.recordCast(1, 100, 2);
    const result = tracker.canCast(1, 100, 2, 0, 5);
    expect(result).toBe(true);
  });

  test("canCast returns false when perTarget limit reached", () => {
    tracker.recordCast(1, 100, 2);
    tracker.recordCast(1, 100, 2);
    const result = tracker.canCast(1, 100, 2, 0, 2);
    expect(result).toBe(false);
  });

  test("canCast respects both perTurn and perTarget limits", () => {
    tracker.recordCast(1, 100, 2);
    tracker.recordCast(1, 100, 3);
    const result1 = tracker.canCast(1, 100, 4, 3, 2);
    expect(result1).toBe(true);
    const result2 = tracker.canCast(1, 100, 2, 3, 1);
    expect(result2).toBe(false);
  });

  test("resetTurn clears counters for a fighter", () => {
    tracker.recordCast(1, 100, 2);
    tracker.recordCast(1, 100, 2);
    tracker.resetTurn(1);
    const result = tracker.canCast(1, 100, 2, 1, 1);
    expect(result).toBe(true);
  });

  test("multiple fighters tracked independently", () => {
    tracker.recordCast(1, 100, 2);
    tracker.recordCast(1, 100, 2);
    const result1 = tracker.canCast(1, 100, 2, 2, 0);
    const result2 = tracker.canCast(2, 100, 2, 2, 0);
    expect(result1).toBe(false);
    expect(result2).toBe(true);
  });

  test("resetTurn does not affect other fighters", () => {
    tracker.recordCast(1, 100, 2);
    tracker.recordCast(2, 100, 2);
    tracker.resetTurn(1);
    const result1 = tracker.canCast(1, 100, 2, 1, 0);
    const result2 = tracker.canCast(2, 100, 2, 1, 0);
    expect(result1).toBe(true);
    expect(result2).toBe(false);
  });
});
