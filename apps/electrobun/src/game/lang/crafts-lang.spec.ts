import { describe, expect, test } from "bun:test";

import {
  type CraftRecipe,
  type CraftsLang,
  craftRecipeTone,
  matchCraftRecipe,
  recipesForSkill,
} from "@/game/lang/crafts-lang";

const plank: CraftRecipe = {
  resultItemId: 459,
  resultName: "Planche de Frêne",
  resultLevel: 1,
  ingredients: [{ itemId: 303, quantity: 2 }],
};

const recipes = new Map<number, CraftRecipe>([[459, plank]]);

describe("matchCraftRecipe", () => {
  test("matches template quantities, not unique item ids", () => {
    expect(
      matchCraftRecipe(
        [459],
        [
          { itemId: 303, quantity: 1 },
          { itemId: 303, quantity: 1 },
        ],
        recipes
      )?.resultName
    ).toBe("Planche de Frêne");
  });

  test("rejects a partial or foreign recipe", () => {
    expect(
      matchCraftRecipe([459], [{ itemId: 303, quantity: 1 }], recipes)
    ).toBeNull();
  });
});

describe("recipesForSkill", () => {
  const staff: CraftRecipe = {
    resultItemId: 700,
    resultName: "Bâton de Bouftier",
    resultLevel: 12,
    ingredients: [{ itemId: 303, quantity: 1 }],
  };
  const lang: CraftsLang = {
    recipes: new Map([
      [459, plank],
      [700, staff],
    ]),
    items: new Map(),
  };

  test("orders the skill's own results by level, cheapest first", () => {
    expect(
      recipesForSkill([700, 459], lang).map((r) => r.resultItemId)
    ).toEqual([459, 700]);
  });

  test("drops ids the skill claims but the bundle has no recipe for", () => {
    expect(recipesForSkill([459, 9999], lang)).toHaveLength(1);
  });
});

describe("craftRecipeTone", () => {
  test("uses grey, green and red at the documented slot gaps", () => {
    expect(craftRecipeTone(2, 6)).toBe("grey");
    expect(craftRecipeTone(3, 6)).toBe("green");
    expect(craftRecipeTone(5, 6)).toBe("red");
  });
});
