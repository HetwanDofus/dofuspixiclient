import { describe, expect, test } from "bun:test";

import {
  parseItemEffects,
  rollItemEffects,
} from "@modules/inventory/item-effects";

describe("parseItemEffects", () => {
  test("reads the 1.29 shape the world importer writes", () => {
    expect(
      parseItemEffects([{ id: 125, param1: 10, param2: 20, param3: "1d7+0" }])
    ).toEqual([{ id: 125, param1: 10, param2: 20, param3: "1d7+0" }]);
  });

  test("drops anything that is not an effect row", () => {
    expect(parseItemEffects([null, 42, "x", { id: 0 }])).toEqual([]);
    expect(parseItemEffects(undefined)).toEqual([]);
    expect(parseItemEffects("[]")).toEqual([]);
  });
});

describe("rollItemEffects", () => {
  test("a rolled value stays inside the template's range", () => {
    for (const r of [0, 0.5, 0.999]) {
      const [effect] = rollItemEffects(
        [{ id: 125, param1: 10, param2: 20, param3: "" }],
        () => r
      );

      expect(effect?.param1).toBeGreaterThanOrEqual(10);
      expect(effect?.param1).toBeLessThanOrEqual(20);
    }
  });

  test("both bounds are reachable", () => {
    const low = rollItemEffects(
      [{ id: 125, param1: 10, param2: 20, param3: "" }],
      () => 0
    );
    const high = rollItemEffects(
      [{ id: 125, param1: 10, param2: 20, param3: "" }],
      () => 0.999
    );

    expect(low[0]?.param1).toBe(10);
    expect(high[0]?.param1).toBe(20);
  });

  test("the roll collapses the range: an instance is a fixed effect", () => {
    const [effect] = rollItemEffects(
      [{ id: 125, param1: 10, param2: 20, param3: "" }],
      () => 0.5
    );

    expect(effect?.param1).toBe(effect?.param2);
  });

  test("a fixed template effect is copied through untouched", () => {
    const fixed = [{ id: 112, param1: 7, param2: 0, param3: "1d7+0" }];

    expect(rollItemEffects(fixed, () => 0.5)).toEqual(fixed);
  });
});
