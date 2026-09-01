import { describe, expect, test } from "bun:test";

import type { HunterDrop } from "@modules/jobs/hunter.rules";
import {
  hunterDropChance,
  hunterMeatLevel,
  rollHunterMeat,
} from "@modules/jobs/hunter.rules";

const TOFU_MEAT: HunterDrop = {
  monsterId: 43,
  itemTemplateId: 1896,
  itemType: 63,
  rate: 100,
  minQuantity: 1,
  maxQuantity: 1,
};

describe("hunter meat tiers", () => {
  test("uses the documented tier instead of the unreliable item level", () => {
    expect(hunterMeatLevel(8499)).toBe(95);
    expect(hunterMeatLevel(1933)).toBe(60);
    expect(hunterMeatLevel(999_999)).toBeNull();
  });
});

describe("rollHunterMeat", () => {
  test("without a hunting weapon, an animal yields no meat", () => {
    expect(
      rollHunterMeat(
        {
          hasHuntingWeapon: false,
          hunterLevel: 100,
          monsterIds: [43],
          drops: [TOFU_MEAT],
          prospection: 100,
        },
        () => 0
      )
    ).toEqual({ items: [], experience: 0 });
  });

  test("a monster with no raw-meat row is not an animal", () => {
    expect(
      rollHunterMeat(
        {
          hasHuntingWeapon: true,
          hunterLevel: 100,
          monsterIds: [52],
          drops: [TOFU_MEAT],
          prospection: 100,
        },
        () => 0
      )
    ).toEqual({ items: [], experience: 0 });
  });

  test("the chance rises with the level gap and is zero below the tier", () => {
    expect(hunterDropChance(100, 0, 1, 100)).toBe(0);
    expect(hunterDropChance(100, 1, 1, 100)).toBe(50);
    expect(hunterDropChance(100, 11, 1, 100)).toBe(75);
    expect(hunterDropChance(100, 21, 1, 100)).toBe(100);
  });

  test("counts each defeated animal and pays profession experience", () => {
    expect(
      rollHunterMeat(
        {
          hasHuntingWeapon: true,
          hunterLevel: 21,
          monsterIds: [43, 43],
          drops: [TOFU_MEAT],
          prospection: 100,
        },
        () => 0
      )
    ).toEqual({
      items: [{ templateId: 1896, quantity: 2 }],
      experience: 20,
    });
  });
});
