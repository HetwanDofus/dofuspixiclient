import type { ItemData } from "@/game/network/protocol";

const CRAFTS_BUNDLE_URL = "/assets/langs/fr/crafts.json";
const ITEMS_BUNDLE_URL = "/assets/langs/fr/items.json";

export interface CraftRecipe {
  resultItemId: number;
  resultName: string;
  /** `I[id].l` — the result's own level. What the recipe book sorts on. */
  resultLevel: number;
  ingredients: Array<{ itemId: number; quantity: number }>;
}

/**
 * The four `items.json` fields a craft window needs about a template it
 * does not own: the name, the level, and the two path segments of the
 * icon (`/assets/items/<typeId>/<gfxId>.svg`).
 *
 * This is deliberately *not* `ItemTemplateData`. That one arrives from the
 * server and only ever covers what the character is carrying, which is the
 * wrong set here: a recipe book lists ingredients the player has never
 * held, and the result of every recipe the skill knows.
 */
export interface CraftItemInfo {
  id: number;
  name: string;
  level: number;
  /** `I[id].t` — the icon's first path segment. */
  typeId: number;
  /** `I[id].g` — the icon's second path segment. */
  gfxId: number;
}

export interface CraftsLang {
  /** Keyed by the result template id, the same key `CR` uses. */
  recipes: Map<number, CraftRecipe>;
  /** Every item the bundle names, results and ingredients alike. */
  items: Map<number, CraftItemInfo>;
}

export type CraftRecipeTone = "none" | "grey" | "green" | "red";

let cache: CraftsLang | null = null;
let loading: Promise<CraftsLang> | null = null;

type CraftsBundle = {
  data?: { CR?: Record<string, Array<[quantity: number, itemId: number]>> };
};

type ItemsBundle = {
  data?: {
    I?: {
      u?: Record<string, { n?: string; l?: number; t?: number; g?: number }>;
    };
  };
};

export function loadCraftsLang(): Promise<CraftsLang> {
  if (cache) {
    return Promise.resolve(cache);
  }

  loading ??= Promise.all([
    fetch(CRAFTS_BUNDLE_URL).then((response) => response.json()),
    fetch(ITEMS_BUNDLE_URL).then((response) => response.json()),
  ]).then(([craftsJson, itemsJson]) => {
    const crafts = (craftsJson as CraftsBundle).data?.CR ?? {};
    const bundleItems = (itemsJson as ItemsBundle).data?.I?.u ?? {};

    const items = new Map<number, CraftItemInfo>();
    for (const [key, entry] of Object.entries(bundleItems)) {
      const id = Number.parseInt(key, 10);
      if (!Number.isFinite(id)) {
        continue;
      }
      items.set(id, {
        id,
        name: entry.n ?? `Objet ${id}`,
        level: entry.l ?? 0,
        typeId: entry.t ?? 0,
        gfxId: entry.g ?? 0,
      });
    }

    const recipes = new Map<number, CraftRecipe>(
      Object.entries(crafts).map(([resultId, ingredients]) => {
        const resultItemId = Number.parseInt(resultId, 10);
        const info = items.get(resultItemId);
        return [
          resultItemId,
          {
            resultItemId,
            resultName: info?.name ?? `Objet ${resultItemId}`,
            resultLevel: info?.level ?? 0,
            ingredients: ingredients.map(([quantity, itemId]) => ({
              itemId,
              quantity,
            })),
          },
        ];
      })
    );

    cache = { recipes, items };
    return cache;
  });

  return loading;
}

export function craftsLangSnapshot(): CraftsLang | null {
  return cache;
}

/**
 * Every recipe a craft skill can make, cheapest first.
 *
 * `SK[skillId].cl` is the skill's own result list and it is unordered —
 * 88 entries for "Sculpter un Bâton", in no particular sequence. Retail
 * sorts its recipe book by the result's level, which is also the only
 * ordering that reads as progression, so that is what this returns. Ids
 * with no `CR` entry are dropped: the skill claims them, the bundle has
 * no recipe for them, and a row with no ingredients says nothing.
 */
export function recipesForSkill(
  craftItemIds: readonly number[],
  lang: CraftsLang | null
): CraftRecipe[] {
  if (!lang) {
    return [];
  }

  const found: CraftRecipe[] = [];
  for (const id of craftItemIds) {
    const recipe = lang.recipes.get(id);
    if (recipe) {
      found.push(recipe);
    }
  }

  return found.sort(
    (a, b) =>
      a.resultLevel - b.resultLevel ||
      a.resultName.localeCompare(b.resultName, "fr")
  );
}

/** Match the laid multiset against the recipes this particular skill owns. */
export function matchCraftRecipe(
  resultItemIds: readonly number[],
  laid: readonly Pick<ItemData, "itemId" | "quantity">[],
  available: ReadonlyMap<number, CraftRecipe> | null = cache?.recipes ?? null
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
