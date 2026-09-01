import { describe, expect, test } from "bun:test";

import { currentPods, maxPods } from "@modules/inventory/pods";

describe("maxPods", () => {
  test("a fresh level-1 character with no strength carries 1000", () => {
    expect(maxPods(0, 0)).toBe(1000);
  });

  test("strength adds 5 pods per point", () => {
    expect(maxPods(20, 0)).toBe(1100);
  });

  test("a pods effect adds on top, and a negative bonus subtracts", () => {
    expect(maxPods(0, 50)).toBe(1050);
    expect(maxPods(0, -50)).toBe(950);
  });

  test("jobs add their own term, and default to none", () => {
    expect(maxPods(20, 50, 1500)).toBe(1100 + 50 + 1500);
    expect(maxPods(20, 50)).toBe(maxPods(20, 50, 0));
  });
});

describe("currentPods", () => {
  test("sums quantity times template weight", () => {
    const weights = new Map([
      [1, 4],
      [2, 10],
    ]);

    expect(
      currentPods(
        [
          { templateId: 1, quantity: 3 },
          { templateId: 2, quantity: 1 },
        ],
        weights
      )
    ).toBe(22);
  });

  test("counts equipped and bagged items alike — position never enters here", () => {
    const weights = new Map([[5, 8]]);

    expect(
      currentPods(
        [
          { templateId: 5, quantity: 1 },
          { templateId: 5, quantity: 1 },
        ],
        weights
      )
    ).toBe(16);
  });

  test("an unknown template contributes no weight rather than throwing", () => {
    expect(currentPods([{ templateId: 999, quantity: 3 }], new Map())).toBe(0);
  });

  test("an empty inventory weighs nothing", () => {
    expect(currentPods([], new Map())).toBe(0);
  });
});
