import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

/** One line of a recipe, as `recipes.ingredients` stores it. */
export interface RecipeIngredient {
  itemId: number;
  quantity: number;
}

export interface Recipe {
  resultItemId: number;
  skillId: number;
  ingredients: RecipeIngredient[];
}

@Injectable()
export class CraftRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  /**
   * Every recipe one craft skill can make.
   *
   * A skill's list is at most a few hundred rows and the table is static, so
   * the match against what is on the bench is done in memory rather than as
   * a query per attempt — there is no index that would answer "which recipe
   * is exactly this multiset of templates" anyway.
   */
  async findBySkill(skillId: number): Promise<Recipe[]> {
    const rows = await this.txHost.tx
      .selectFrom("recipes")
      .select(["resultItemId", "skillId", "ingredients"])
      .where("skillId", "=", skillId)
      .execute();

    return rows.map((row) => ({
      resultItemId: row.resultItemId,
      skillId: row.skillId,
      ingredients: toIngredients(row.ingredients),
    }));
  }
}

function toIngredients(value: unknown): RecipeIngredient[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: RecipeIngredient[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const { itemId, quantity } = entry as Record<string, unknown>;

    if (typeof itemId === "number" && typeof quantity === "number") {
      out.push({ itemId, quantity });
    }
  }

  return out;
}
