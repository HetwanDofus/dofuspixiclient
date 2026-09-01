import { describe, expect, test } from "bun:test";

import {
  baseSuccessRate,
  craftDifficulty,
  craftExperience,
  displayedSuccessRate,
  fitsInGrid,
  isCertain,
  isSkillUnlocked,
  MAX_SUCCESS_RATE,
  MIN_SUCCESS_RATE,
  rollCraft,
  SKILL_HUSKING,
  SKILL_STONE_POLISHING,
  successRate,
} from "@modules/jobs/craft.rules";

/** Any craft skill with no exception attached to it — "Scier", Bûcheron. */
const SAWING = 101;

describe("craftExperience — the published 1.29 table", () => {
  /**
   * The whole table, transcribed from the reference and checked cell by
   * cell. Columns are ingredient counts 1..8; a zero is a grey recipe.
   * Reproducing it here rather than asserting the *rule* is the point: the
   * rule is a compression of this, and a compression that dropped a row
   * would still look plausible.
   */
  const TABLE: readonly [level: number, xp: readonly number[]][] = [
    [1, [1, 10, 0, 0, 0, 0, 0, 0]],
    [9, [1, 10, 0, 0, 0, 0, 0, 0]],
    [10, [1, 10, 25, 0, 0, 0, 0, 0]],
    [19, [1, 10, 25, 0, 0, 0, 0, 0]],
    [20, [1, 10, 25, 50, 0, 0, 0, 0]],
    [39, [1, 10, 25, 50, 0, 0, 0, 0]],
    [40, [0, 10, 25, 50, 100, 0, 0, 0]],
    [59, [0, 10, 25, 50, 100, 0, 0, 0]],
    [60, [0, 0, 25, 50, 100, 250, 0, 0]],
    [79, [0, 0, 25, 50, 100, 250, 0, 0]],
    [80, [0, 0, 0, 50, 100, 250, 500, 0]],
    [99, [0, 0, 0, 50, 100, 250, 500, 0]],
    [100, [0, 0, 0, 0, 100, 250, 500, 1000]],
  ];

  for (const [jobLevel, expected] of TABLE) {
    test(`level ${jobLevel}`, () => {
      const row = expected.map((_, i) =>
        craftExperience({ jobLevel, ingredientCount: i + 1 })
      );

      expect(row).toEqual([...expected]);
    });
  }

  test("a recipe larger than the grid is worth nothing", () => {
    expect(craftExperience({ jobLevel: 1, ingredientCount: 3 })).toBe(0);
    expect(fitsInGrid({ jobLevel: 1, ingredientCount: 3 })).toBe(false);
  });

  test("an empty grid is not a craft", () => {
    expect(fitsInGrid({ jobLevel: 100, ingredientCount: 0 })).toBe(false);
    expect(craftExperience({ jobLevel: 100, ingredientCount: 0 })).toBe(0);
  });
});

describe("baseSuccessRate", () => {
  test("is flat at 50 below level 10", () => {
    expect(baseSuccessRate(1)).toBe(MIN_SUCCESS_RATE);
    expect(baseSuccessRate(9)).toBe(MIN_SUCCESS_RATE);
  });

  test("climbs five points per ten levels", () => {
    expect(baseSuccessRate(10)).toBe(54);
    expect(baseSuccessRate(20)).toBe(59);
    expect(baseSuccessRate(50)).toBe(74);
    expect(baseSuccessRate(90)).toBe(94);
  });

  test("reaches 99 only at the ceiling", () => {
    expect(baseSuccessRate(99)).toBeLessThan(MAX_SUCCESS_RATE);
    expect(baseSuccessRate(100)).toBe(MAX_SUCCESS_RATE);
  });

  test("never exceeds 99, so a craft is never printed as certain by luck", () => {
    for (let level = 1; level <= 100; level++) {
      expect(baseSuccessRate(level)).toBeLessThanOrEqual(MAX_SUCCESS_RATE);
    }
  });
});

describe("isCertain", () => {
  test("a recipe two slots below the ceiling cannot fail", () => {
    // Level 100 holds 8; a 6-ingredient recipe is certain, a 7 is not.
    expect(
      isCertain({ jobLevel: 100, skillId: SAWING, ingredientCount: 6 })
    ).toBe(true);
    expect(
      isCertain({ jobLevel: 100, skillId: SAWING, ingredientCount: 7 })
    ).toBe(false);
  });

  test("husking never fails, whatever its size or the level", () => {
    expect(
      isCertain({ jobLevel: 1, skillId: SKILL_HUSKING, ingredientCount: 2 })
    ).toBe(true);
  });

  test("a certain craft shows 99, not 100", () => {
    const context = { jobLevel: 100, skillId: SAWING, ingredientCount: 6 };

    expect(successRate(context)).toBe(100);
    expect(displayedSuccessRate(context)).toBe(99);
  });

  test("an uncertain craft shows its real, rounded-down rate", () => {
    expect(
      displayedSuccessRate({
        jobLevel: 99,
        skillId: SAWING,
        ingredientCount: 8,
      })
    ).toBe(98);
  });
});

describe("craftDifficulty", () => {
  test("grey is worth nothing — not merely easy", () => {
    // Level 100, one ingredient: certain, and below the experience reach.
    expect(
      craftDifficulty({ jobLevel: 100, skillId: SAWING, ingredientCount: 1 })
    ).toBe("grey");
  });

  test("green pays and cannot fail", () => {
    expect(
      craftDifficulty({ jobLevel: 100, skillId: SAWING, ingredientCount: 6 })
    ).toBe("green");
  });

  test("red pays and can fail", () => {
    expect(
      craftDifficulty({ jobLevel: 100, skillId: SAWING, ingredientCount: 8 })
    ).toBe("red");
  });

  test("every recipe that pays is green or red, never grey", () => {
    for (let level = 1; level <= 100; level++) {
      for (let count = 1; count <= 8; count++) {
        const context = {
          jobLevel: level,
          skillId: SAWING,
          ingredientCount: count,
        };
        const pays = craftExperience(context) > 0;

        expect(craftDifficulty(context) === "grey").toBe(!pays);
      }
    }
  });
});

describe("isSkillUnlocked", () => {
  test("stone polishing opens at 40 and not before", () => {
    expect(isSkillUnlocked(SKILL_STONE_POLISHING, 39)).toBe(false);
    expect(isSkillUnlocked(SKILL_STONE_POLISHING, 40)).toBe(true);
  });

  test("every other craft skill is open from level 1", () => {
    expect(isSkillUnlocked(SAWING, 1)).toBe(true);
  });
});

describe("rollCraft", () => {
  test("a certain craft succeeds on the worst possible roll", () => {
    expect(
      rollCraft(
        { jobLevel: 100, skillId: SAWING, ingredientCount: 6 },
        0.999_999
      )
    ).toBe(true);
  });

  test("an uncertain craft fails above its rate", () => {
    // Level 10 sawing at 3 ingredients: base rate 54.
    const context = { jobLevel: 10, skillId: SAWING, ingredientCount: 3 };

    expect(rollCraft(context, 0.53)).toBe(true);
    expect(rollCraft(context, 0.55)).toBe(false);
  });
});
