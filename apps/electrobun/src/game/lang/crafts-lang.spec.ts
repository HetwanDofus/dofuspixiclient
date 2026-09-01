import { describe, expect, test } from "bun:test";

import {
  type CraftRecipe,
  craftRecipeTone,
  matchCraftRecipe,
} from "@/game/lang/crafts-lang";

const recipes = new Map<number, CraftRecipe>([
  [
    459,
    {
      resultItemId: 459,
      resultName: "Planche de Frêne",
      ingredients: [{ itemId: 303, quantity: 2 }],
    },
  ],
]);

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

describe("craftRecipeTone", () => {
  test("uses grey, green and red at the documented slot gaps", () => {
    expect(craftRecipeTone(2, 6)).toBe("grey");
    expect(craftRecipeTone(3, 6)).toBe("green");
    expect(craftRecipeTone(5, 6)).toBe("red");
  });
});
