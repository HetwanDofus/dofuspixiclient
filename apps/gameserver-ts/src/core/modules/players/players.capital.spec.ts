import "reflect-metadata";

import { describe, expect, test } from "bun:test";

import type { BoostableStat } from "@modules/stats/boost-cost";
import {
  capitalSpentOnSpells,
  capitalSpentOnStats,
  expectedCapital,
} from "@modules/players/players.capital";

/** Féca. Vitality costs 1 flat, wisdom 3 flat, agility 2 then 3 at 20. */
const FECA = 1;

function stats(over: Partial<Record<BoostableStat, number>> = {}) {
  return {
    strength: 0,
    vitality: 0,
    wisdom: 0,
    chance: 0,
    agility: 0,
    intelligence: 0,
    ...over,
  };
}

describe("capitalSpentOnStats", () => {
  test("charges the flat tier point by point", () => {
    expect(capitalSpentOnStats(FECA, stats({ vitality: 72 }))).toBe(72);
    expect(capitalSpentOnStats(FECA, stats({ wisdom: 3 }))).toBe(9);
  });

  test("crosses a price tier at the threshold, not after it", () => {
    // Féca agility: 2 below 20, 3 from 20. 21 points = 20×2 + 1×3.
    expect(capitalSpentOnStats(FECA, stats({ agility: 21 }))).toBe(43);
  });

  test("costs nothing at zero", () => {
    expect(capitalSpentOnStats(FECA, stats())).toBe(0);
  });
});

describe("capitalSpentOnSpells", () => {
  test("prices an upgrade by the level being left", () => {
    // 1→2 costs 1, 2→3 costs 2.
    expect(capitalSpentOnSpells([3])).toBe(3);
    // 15 points to max one spell, 1.29's own total.
    expect(capitalSpentOnSpells([6])).toBe(15);
  });

  test("ignores spells still at level 1", () => {
    expect(capitalSpentOnSpells([1, 1, 1])).toBe(0);
  });
});

describe("expectedCapital", () => {
  test("derives the dev character's real balances", () => {
    // The case that exposed the gap: level 101 set by hand, its 500
    // characteristic points credited, its 100 spell points forgotten.
    const result = expectedCapital({
      classId: FECA,
      level: 101,
      stats: stats({
        strength: 1,
        vitality: 72,
        wisdom: 3,
        intelligence: 2,
        chance: 10,
        agility: 12,
      }),
      spellLevels: [3],
    });

    expect(result.statsSpent).toBe(119);
    expect(result.statsPoints).toBe(381);
    expect(result.spellsSpent).toBe(3);
    expect(result.spellPoints).toBe(97);
  });

  test("a fresh level 1 has earned nothing", () => {
    const result = expectedCapital({
      classId: FECA,
      level: 1,
      stats: stats(),
      spellLevels: [1, 1, 1],
    });

    expect(result.statsPoints).toBe(0);
    expect(result.spellPoints).toBe(0);
  });

  test("is an assignment, so applying it twice changes nothing", () => {
    const input = {
      classId: FECA,
      level: 50,
      stats: stats({ vitality: 100 }),
      spellLevels: [2, 2],
    };

    expect(expectedCapital(input)).toEqual(expectedCapital(input));
  });
});
