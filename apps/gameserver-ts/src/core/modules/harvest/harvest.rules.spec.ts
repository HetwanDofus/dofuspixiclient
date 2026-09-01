import { describe, expect, test } from "bun:test";

import {
  BASE_HARVEST_MS,
  harvestDuration,
  harvestQuantity,
  levelAdvantage,
  MIN_HARVEST_MS,
} from "@modules/harvest/harvest.rules";

describe("harvestDuration", () => {
  test("no advantage costs the full twelve seconds", () => {
    expect(harvestDuration(1, 1)).toBe(BASE_HARVEST_MS);
    expect(harvestDuration(30, 30)).toBe(BASE_HARVEST_MS);
  });

  test("sheds 100 ms per level of advantage", () => {
    expect(harvestDuration(11, 1)).toBe(11_000);
    expect(harvestDuration(51, 1)).toBe(7000);
  });

  test("a level-100 character on a level-1 resource is near the floor", () => {
    expect(harvestDuration(100, 1)).toBe(2100);
  });

  test("never goes below the floor, whatever the gap", () => {
    expect(harvestDuration(1000, 1)).toBe(MIN_HARVEST_MS);
  });

  test("a character below the minimum is not slower than one exactly at it", () => {
    // The service refuses the harvest outright in that case; the rule must
    // still not produce a longer action than the legitimate one.
    expect(harvestDuration(1, 50)).toBe(BASE_HARVEST_MS);
  });
});

describe("harvestQuantity", () => {
  test("with no advantage the spread is one or two", () => {
    expect(harvestQuantity(1, 1, 0)).toBe(1);
    expect(harvestQuantity(1, 1, 0.99)).toBe(2);
  });

  test("gains one more possible unit every five levels of advantage", () => {
    expect(harvestQuantity(6, 1, 0.99)).toBe(3);
    expect(harvestQuantity(11, 1, 0.99)).toBe(4);
    expect(harvestQuantity(15, 1, 0.99)).toBe(4);
    expect(harvestQuantity(16, 1, 0.99)).toBe(5);
  });

  test("always yields at least one", () => {
    expect(harvestQuantity(100, 1, 0)).toBe(1);
  });

  test("a roll of exactly 1 does not overshoot the spread", () => {
    expect(harvestQuantity(1, 1, 1)).toBe(2);
  });
});

describe("levelAdvantage", () => {
  test("is never negative", () => {
    expect(levelAdvantage(1, 70)).toBe(0);
    expect(levelAdvantage(70, 1)).toBe(69);
  });
});
