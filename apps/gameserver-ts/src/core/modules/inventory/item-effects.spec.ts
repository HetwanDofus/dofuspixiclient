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
        [{ id: 125, param1: 10, param2: 20, param3: "1d11-1" }],
        () => r
      );

      expect(effect?.param1).toBeGreaterThanOrEqual(10);
      expect(effect?.param1).toBeLessThanOrEqual(20);
    }
  });

  test("both bounds are reachable", () => {
    const low = rollItemEffects(
      [{ id: 125, param1: 10, param2: 20, param3: "1d11-1" }],
      () => 0
    );
    const high = rollItemEffects(
      [{ id: 125, param1: 10, param2: 20, param3: "1d11-1" }],
      () => 0.999
    );

    expect(low[0]?.param1).toBe(10);
    expect(high[0]?.param1).toBe(20);
  });

  test("the roll collapses the range: an instance is a fixed effect", () => {
    const [effect] = rollItemEffects(
      [{ id: 125, param1: 10, param2: 20, param3: "1d11-1" }],
      () => 0.5
    );

    expect(effect?.param1).toBe(effect?.param2);
  });

  test("a fixed template effect is copied through untouched", () => {
    const fixed = [{ id: 112, param1: 7, param2: 0, param3: "1d7+0" }];

    expect(rollItemEffects(fixed, () => 0.5)).toEqual(fixed);
  });

  // QA-079: a pet's bookkeeping effects have param2 > param1 (e.g. 800's
  // "5..72" in the imported set) but are not jets — `param3` is a bare
  // number, never a dice formula, and effects.json doesn't mark them "j".
  // Rolling one gave a permanent, meaningless random pet HP value.
  test("pet HP bookkeeping (800) is not rolled — param3 isn't a dice formula", () => {
    const [effect] = rollItemEffects(
      [{ id: 800, param1: 5, param2: 72, param3: "a" }],
      () => 0.5
    );

    expect(effect?.param1).toBe(5);
    expect(effect?.param2).toBe(72);
  });

  test("'Lié au compte' (983) is not rolled", () => {
    const [effect] = rollItemEffects(
      [{ id: 983, param1: 600, param2: 1, param3: "ca" }],
      () => 0.5
    );

    expect(effect?.param1).toBe(600);
    expect(effect?.param2).toBe(1);
  });

  test("tool resistance (812) is not rolled", () => {
    const [effect] = rollItemEffects(
      [{ id: 812, param1: 1, param2: 1, param3: "1" }],
      () => 0.5
    );

    expect(effect?.param1).toBe(1);
    expect(effect?.param2).toBe(1);
  });
});
