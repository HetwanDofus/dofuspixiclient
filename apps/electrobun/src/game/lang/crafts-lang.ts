import type { ItemData } from "@/game/network/protocol";

const CRAFTS_BUNDLE_URL = "/assets/langs/fr/crafts.json";
const ITEMS_BUNDLE_URL = "/assets/langs/fr/items.json";

export interface CraftRecipe {
  resultItemId: number;
  resultName: string;
  ingredients: Array<{ itemId: number; quantity: number }>;
}

export type CraftRecipeTone = "none" | "grey" | "green" | "red";

let recipes: Map<number, CraftRecipe> | null = null;
let loading: Promise<Map<number, CraftRecipe>> | null = null;

type CraftsBundle = {
  data?: { CR?: Record<string, Array<[quantity: number, itemId: number]>> };
};

type ItemsBundle = {
  data?: { I?: { u?: Record<string, { n?: string }> } };
};

export function loadCraftsLang(): Promise<Map<number, CraftRecipe>> {
  if (recipes) {
    return Promise.resolve(recipes);
  }

  loading ??= Promise.all([
    fetch(CRAFTS_BUNDLE_URL).then((response) => response.json()),
    fetch(ITEMS_BUNDLE_URL).then((response) => response.json()),
  ]).then(([craftsJson, itemsJson]) => {
    const crafts = (craftsJson as CraftsBundle).data?.CR ?? {};
    const items = (itemsJson as ItemsBundle).data?.I?.u ?? {};
    recipes = new Map(
      Object.entries(crafts).map(([resultId, ingredients]) => {
        const resultItemId = Number.parseInt(resultId, 10);
        return [
          resultItemId,
          {
            resultItemId,
            resultName: items[resultId]?.n ?? `Objet ${resultItemId}`,
            ingredients: ingredients.map(([quantity, itemId]) => ({
              itemId,
              quantity,
            })),
          },
        ];
      })
    );
    return recipes;
  });

  return loading;
}

export function craftsLangSnapshot(): ReadonlyMap<number, CraftRecipe> | null {
  return recipes;
}

/** Match the laid multiset against the recipes this particular skill owns. */
export function matchCraftRecipe(
  resultItemIds: readonly number[],
  laid: readonly Pick<ItemData, "itemId" | "quantity">[],
  available: ReadonlyMap<number, CraftRecipe> | null = recipes
): CraftRecipe | null {
  if (!available || laid.length === 0) {
    return null;
  }

  const quantities = new Map<number, number>();
  for (const item of laid) {
    quantities.set(
      item.itemId,
      (quantities.get(item.itemId) ?? 0) + item.quantity
    );
  }

  for (const resultItemId of resultItemIds) {
    const recipe = available.get(resultItemId);
    if (!recipe || recipe.ingredients.length !== quantities.size) {
      continue;
    }

    if (
      recipe.ingredients.every(
        (ingredient) =>
          quantities.get(ingredient.itemId) === ingredient.quantity
      )
    ) {
      return recipe;
    }
  }

  return null;
}

/** 1.29 recipe-line colours from the frozen slot count of the open bench. */
export function craftRecipeTone(
  ingredientKinds: number,
  maxSlots: number
): CraftRecipeTone {
  if (ingredientKinds <= 0 || maxSlots <= 0) {
    return "none";
  }
  if (ingredientKinds < maxSlots - 3) {
    return "grey";
  }
  if (ingredientKinds <= maxSlots - 2) {
    return "green";
  }
  return "red";
}
