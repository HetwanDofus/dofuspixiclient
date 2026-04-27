import { describe, expect, test } from "bun:test";

import { type ComputedStats } from "@modules/stats/stats.service";

function applyItemEffect(
  stats: ComputedStats,
  effectId: number,
  value: number
): void {
  const mapping: Record<number, keyof ComputedStats> = {
    118: "strength",
    126: "intelligence",
    119: "agility",
    123: "chance",
    124: "wisdom",
    125: "vitality",
    111: "ap",
    128: "mp",
    117: "range",
    182: "summons",
    112: "damageBonus",
    138: "damagePct",
    178: "healBonus",
    115: "criticalHit",
    122: "criticalFail",
    174: "dodgeAp",
    175: "dodgeMp",
    240: "resistNeutral",
    241: "resistNeutralPct",
    242: "resistEarth",
    243: "resistEarthPct",
    244: "resistWater",
    245: "resistWaterPct",
    246: "resistAir",
    247: "resistAirPct",
    248: "resistFire",
    249: "resistFirePct",
  };
  const field = mapping[effectId];
  if (field) {
    stats[field] += value;
  }
}

function emptyComputedStats(): ComputedStats {
  return {
    strength: 0,
    vitality: 0,
    wisdom: 0,
    chance: 0,
    agility: 0,
    intelligence: 0,
    ap: 0,
    mp: 0,
    range: 0,
    summons: 0,
    damageBonus: 0,
    damagePct: 0,
    healBonus: 0,
    criticalHit: 0,
    criticalFail: 0,
    dodgeAp: 0,
    dodgeMp: 0,
    resistNeutral: 0,
    resistNeutralPct: 0,
    resistEarth: 0,
    resistEarthPct: 0,
    resistWater: 0,
    resistWaterPct: 0,
    resistAir: 0,
    resistAirPct: 0,
    resistFire: 0,
    resistFirePct: 0,
  };
}

describe("applyItemEffect", () => {
  test("maps effect 118 to strength", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 118, 10);
    expect(stats.strength).toBe(10);
  });

  test("maps effect 126 to intelligence", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 126, 5);
    expect(stats.intelligence).toBe(5);
  });

  test("maps effect 119 to agility", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 119, 3);
    expect(stats.agility).toBe(3);
  });

  test("maps effect 123 to chance", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 123, 7);
    expect(stats.chance).toBe(7);
  });

  test("maps effect 124 to wisdom", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 124, 8);
    expect(stats.wisdom).toBe(8);
  });

  test("maps effect 125 to vitality", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 125, 15);
    expect(stats.vitality).toBe(15);
  });

  test("maps effect 111 to ap", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 111, 1);
    expect(stats.ap).toBe(1);
  });

  test("maps effect 128 to mp", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 128, 1);
    expect(stats.mp).toBe(1);
  });

  test("maps effect 112 to damageBonus", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 112, 20);
    expect(stats.damageBonus).toBe(20);
  });

  test("maps effect 138 to damagePct", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 138, 5);
    expect(stats.damagePct).toBe(5);
  });

  test("maps effect 240 to resistNeutral", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 240, 10);
    expect(stats.resistNeutral).toBe(10);
  });

  test("maps effect 241 to resistNeutralPct", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 241, 5);
    expect(stats.resistNeutralPct).toBe(5);
  });

  test("ignores unknown effect id", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 9999, 50);
    expect(stats.strength).toBe(0);
    expect(stats.intelligence).toBe(0);
    expect(stats.agility).toBe(0);
  });

  test("accumulates multiple effects", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 118, 10);
    applyItemEffect(stats, 118, 5);
    expect(stats.strength).toBe(15);
  });

  test("handles negative values", () => {
    const stats = emptyComputedStats();
    applyItemEffect(stats, 118, 10);
    applyItemEffect(stats, 118, -3);
    expect(stats.strength).toBe(7);
  });
});

describe("emptyComputedStats", () => {
  test("returns all zeros", () => {
    const stats = emptyComputedStats();
    expect(stats.strength).toBe(0);
    expect(stats.vitality).toBe(0);
    expect(stats.wisdom).toBe(0);
    expect(stats.chance).toBe(0);
    expect(stats.agility).toBe(0);
    expect(stats.intelligence).toBe(0);
    expect(stats.ap).toBe(0);
    expect(stats.mp).toBe(0);
    expect(stats.range).toBe(0);
    expect(stats.summons).toBe(0);
    expect(stats.damageBonus).toBe(0);
    expect(stats.damagePct).toBe(0);
    expect(stats.healBonus).toBe(0);
    expect(stats.criticalHit).toBe(0);
    expect(stats.criticalFail).toBe(0);
    expect(stats.dodgeAp).toBe(0);
    expect(stats.dodgeMp).toBe(0);
    expect(stats.resistNeutral).toBe(0);
    expect(stats.resistNeutralPct).toBe(0);
    expect(stats.resistEarth).toBe(0);
    expect(stats.resistEarthPct).toBe(0);
    expect(stats.resistWater).toBe(0);
    expect(stats.resistWaterPct).toBe(0);
    expect(stats.resistAir).toBe(0);
    expect(stats.resistAirPct).toBe(0);
    expect(stats.resistFire).toBe(0);
    expect(stats.resistFirePct).toBe(0);
  });
});
