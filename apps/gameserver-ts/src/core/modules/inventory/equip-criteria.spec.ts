import { describe, expect, test } from "bun:test";

import {
  type CriteriaContext,
  evaluateCriteria,
} from "@modules/inventory/equip-criteria";

function ctx(overrides: Partial<CriteriaContext> = {}): CriteriaContext {
  return {
    strength: 0,
    intelligence: 0,
    agility: 0,
    vitality: 0,
    chance: 0,
    wisdom: 0,
    level: 1,
    sex: 0,
    ...overrides,
  };
}

describe("evaluateCriteria", () => {
  test("an empty expression always passes", () => {
    expect(evaluateCriteria("", ctx())).toBe(true);
  });

  test("a single threshold, from a real weapon (CS>4)", () => {
    expect(evaluateCriteria("CS>4", ctx({ strength: 5 }))).toBe(true);
    expect(evaluateCriteria("CS>4", ctx({ strength: 4 }))).toBe(false);
    expect(evaluateCriteria("CS>4", ctx({ strength: 3 }))).toBe(false);
  });

  test("& requires every clause, from a real weapon (CS>42&CI>6)", () => {
    const expr = "CS>42&CI>6";
    expect(evaluateCriteria(expr, ctx({ strength: 43, intelligence: 7 }))).toBe(
      true
    );
    expect(evaluateCriteria(expr, ctx({ strength: 43, intelligence: 6 }))).toBe(
      false
    );
    expect(evaluateCriteria(expr, ctx({ strength: 40, intelligence: 7 }))).toBe(
      false
    );
  });

  test("three stats at once, from a real weapon (CS>80&CV>40&CA>40)", () => {
    const pass = ctx({ strength: 81, vitality: 41, agility: 41 });
    expect(evaluateCriteria("CS>80&CV>40&CA>40", pass)).toBe(true);

    const oneShort = ctx({ strength: 81, vitality: 41, agility: 40 });
    expect(evaluateCriteria("CS>80&CV>40&CA>40", oneShort)).toBe(false);
  });

  test("level thresholds, from real consumables (PL<16, PL>59)", () => {
    expect(evaluateCriteria("PL<16", ctx({ level: 15 }))).toBe(true);
    expect(evaluateCriteria("PL<16", ctx({ level: 16 }))).toBe(false);
    expect(evaluateCriteria("PL>59", ctx({ level: 60 }))).toBe(true);
    expect(evaluateCriteria("PL>59", ctx({ level: 59 }))).toBe(false);
  });

  test("sex equality, from real wedding hats (PS=0 / PS=1)", () => {
    expect(evaluateCriteria("PS=0", ctx({ sex: 0 }))).toBe(true);
    expect(evaluateCriteria("PS=0", ctx({ sex: 1 }))).toBe(false);
    expect(evaluateCriteria("PS=1", ctx({ sex: 1 }))).toBe(true);
  });

  test("! is not-equal", () => {
    expect(evaluateCriteria("PL!10", ctx({ level: 9 }))).toBe(true);
    expect(evaluateCriteria("PL!10", ctx({ level: 10 }))).toBe(false);
  });

  test("parentheses and | group correctly, from a real quest item", () => {
    // Sc=2&(PB=4|PB=22|PB=170) — PB is unsupported, so even the branch
    // that would satisfy the OR must still fail the whole expression.
    const expr = "Sc=2&(PB=4|PB=22|PB=170)";
    const onUnsupported = mockLog();
    expect(evaluateCriteria(expr, ctx(), onUnsupported.fn)).toBe(false);
    expect(onUnsupported.calls).toEqual([["Sc", expr]]);
  });

  test("| is satisfied by either side when both sides are supported", () => {
    expect(evaluateCriteria("PL>50|PL<10", ctx({ level: 60 }))).toBe(true);
    expect(evaluateCriteria("PL>50|PL<10", ctx({ level: 5 }))).toBe(true);
    expect(evaluateCriteria("PL>50|PL<10", ctx({ level: 30 }))).toBe(false);
  });

  test("an unsupported code fails closed and reports itself", () => {
    const onUnsupported = mockLog();
    expect(evaluateCriteria("PB=86", ctx(), onUnsupported.fn)).toBe(false);
    expect(onUnsupported.calls).toEqual([["PB", "PB=86"]]);
  });

  test("an unsupported code inside & fails the whole expression, not just its clause", () => {
    const onUnsupported = mockLog();
    expect(
      evaluateCriteria(
        "CS>1000000&PB=86",
        ctx({ strength: 1 }),
        onUnsupported.fn
      )
    ).toBe(false);
    // The unsatisfied CS clause alone would already fail closed here, but
    // the point is: swap the numbers so CS *would* pass —
    expect(
      evaluateCriteria("CS>0&PB=86", ctx({ strength: 1 }), onUnsupported.fn)
    ).toBe(false);
  });

  test("BI's literal marker is unsupported and always fails", () => {
    expect(evaluateCriteria("BI=non équipable", ctx())).toBe(false);
  });

  test("malformed input fails closed instead of throwing", () => {
    expect(() => evaluateCriteria("((CS>", ctx())).not.toThrow();
    expect(evaluateCriteria("((CS>", ctx())).toBe(false);
  });
});

function mockLog() {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    fn: (code: string, expression: string) => {
      calls.push([code, expression]);
    },
  };
}
