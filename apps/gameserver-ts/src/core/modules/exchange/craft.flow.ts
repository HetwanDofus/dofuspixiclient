import type { CraftState } from "@modules/exchange/craft.registry";
import type { Recipe } from "@modules/exchange/craft.repository";
import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, ItemRow } from "@shared/db/schema";
import { CraftRegistryService } from "@modules/exchange/craft.registry";
import { CraftRepository } from "@modules/exchange/craft.repository";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { rollItemEffects } from "@modules/inventory/item-effects";
import {
  craftExperience,
  fitsInGrid,
  isSkillUnlocked,
  rollCraft,
} from "@modules/jobs/craft.rules";
import { JobsService } from "@modules/jobs/jobs.service";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

export type CraftDenial =
  | "no-bench"
  | "not-found"
  | "equipped"
  | "not-enough"
  | "invalid-quantity"
  | "no-slot-left"
  | "empty-bench"
  | "no-such-recipe"
  | "skill-locked"
  | "recipe-too-large";

export type CraftResult = { ok: true } | { ok: false; reason: CraftDenial };

/** The largest series the client may ask for, and 1.29's own cap. */
const MAX_SERIES = 1000;

/**
 * The workbench — exchange type 3.
 *
 * It reuses three messages the client already speaks and invents none:
 * `EMO` lays an ingredient in a slot, `EK` is the "Créer" button
 * (`Craft.as:379` sends `ready()` when the pile is non-empty), and `Ec`
 * carries the single letter that says how it went. That is the whole
 * protocol; a design needing a fourth message would be one that had
 * misread the decompiled window.
 *
 * The bench is **in memory** (`CraftRegistryService`), like a trade's offer
 * and for the same reason: an ingredient in a slot is a proposal, and rows
 * move exactly once, when the craft commits. Closing the window, walking
 * away or dropping the socket therefore has nothing to undo.
 *
 * Two rules here are counter-intuitive and both are 1.29:
 *
 *  - the ingredients are consumed on a **failure** too;
 *  - the experience is granted on a failure too.
 *
 * They are asserted in `craft.flow.spec.ts` precisely so that nobody
 * "fixes" them later.
 */
@Injectable()
export class CraftFlow {
  private readonly logger = new Logger(CraftFlow.name);

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly benches: CraftRegistryService,
    private readonly recipes: CraftRepository,
    private readonly inventory: InventoryRepository,
    private readonly inventoryFrames: InventoryFramesService,
    private readonly jobs: JobsService,
    private readonly stats: StatsService,
    private readonly frames: ExchangeFramesService
  ) {}

  /** `EC3`. The recipe list is the client's own — see `openCraft`. */
  announceOpen(session: ExchangeSession): void {
    this.frames.openCraft(session.sessionId, session.kind);
  }

  /**
   * `EMO` — lay an ingredient in a slot, or take it back.
   *
   * `quantity` is the absolute amount the player wants on the bench for that
   * stack, matching the offer contract; `add: false` clears the slot.
   */
  async moveItem(
    session: ExchangeSession,
    add: boolean,
    itemId: string,
    quantity: number
  ): Promise<CraftResult> {
    const bench = this.benches.get(session.sessionId);

    if (!bench) {
      return { ok: false, reason: "no-bench" };
    }

    const item = await this.inventory.findOwned(session.characterId, itemId);

    if (!item) {
      return { ok: false, reason: "not-found" };
    }

    if (!add) {
      delete bench.slots[itemId];
      this.frames.benchItem(session.sessionId, false, item);
      return { ok: true };
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, reason: "invalid-quantity" };
    }

    // A worn item is not an ingredient. Same rule as the bank's, and for
    // the same reason: the paperdoll and the bench would disagree.
    if (item.position >= 0) {
      return { ok: false, reason: "equipped" };
    }

    if (quantity > item.quantity) {
      return { ok: false, reason: "not-enough" };
    }

    // The grid's size was frozen when the window opened; a level gained
    // since does not widen it until it is closed and reopened.
    const wouldOccupy =
      bench.slots[itemId] === undefined
        ? Object.keys(bench.slots).length + 1
        : Object.keys(bench.slots).length;

    if (wouldOccupy > bench.maxSlots) {
      return { ok: false, reason: "no-slot-left" };
    }

    bench.slots[itemId] = quantity;
    this.frames.benchItem(session.sessionId, true, {
      ...item,
      quantity,
    });

    return { ok: true };
  }

  /** `EK` — the "Créer" button. One attempt. */
  async craft(session: ExchangeSession): Promise<CraftResult> {
    const bench = this.benches.get(session.sessionId);

    if (!bench) {
      return { ok: false, reason: "no-bench" };
    }

    const outcome = await this.attempt(bench);

    if (!outcome.ok) {
      return outcome;
    }

    return { ok: true };
  }

  /**
   * `EMR<n>` — the same craft, up to `n` times.
   *
   * The loop stops on the first attempt that cannot even be tried — the
   * ingredients ran out — rather than on the first *failure*, because a
   * failure is a legitimate outcome that still consumed a round.
   */
  async repeat(session: ExchangeSession, count: number): Promise<CraftResult> {
    const bench = this.benches.get(session.sessionId);

    if (!bench) {
      return { ok: false, reason: "no-bench" };
    }

    const rounds = Math.min(Math.max(1, Math.trunc(count)), MAX_SERIES);
    const recipe = await this.matchRecipe(bench);

    if (!recipe.ok) {
      return recipe;
    }

    bench.crafted = 0;

    for (let i = 0; i < rounds; i++) {
      // The player may have pressed "stop" between two rounds.
      if (
        this.benches.get(session.sessionId) !== bench ||
        bench.remaining < 0
      ) {
        break;
      }

      bench.remaining = rounds - i - 1;

      const outcome = await this.attempt(bench, recipe.value);

      if (!outcome.ok) {
        break;
      }

      bench.crafted++;
      this.frames.craftLoop(
        session.sessionId,
        bench.remaining,
        recipe.value.resultItemId
      );

      if (!(await this.refill(bench, recipe.value))) {
        break;
      }
    }

    this.frames.craftLoopEnd(
      session.sessionId,
      bench.crafted,
      recipe.value.resultItemId
    );
    bench.remaining = 0;

    return { ok: true };
  }

  /** `EMr` — stop the series after the round in flight. */
  stopRepeat(session: ExchangeSession): CraftResult {
    const bench = this.benches.get(session.sessionId);

    if (!bench) {
      return { ok: false, reason: "no-bench" };
    }

    bench.remaining = -1;

    return { ok: true };
  }

  /**
   * One attempt: consume, roll, pay.
   *
   * Everything is one transaction. A craft that took the ingredients and
   * failed to grant the experience — or the reverse — is worse than one that
   * did not happen, and a series makes that window a hundred times wider.
   */
  private async attempt(
    bench: CraftState,
    known?: Recipe
  ): Promise<
    { ok: true; success: boolean } | { ok: false; reason: CraftDenial }
  > {
    if (!isSkillUnlocked(bench.skillId, bench.jobLevel)) {
      return { ok: false, reason: "skill-locked" };
    }

    const matched = known
      ? ({ ok: true, value: known } as const)
      : await this.matchRecipe(bench);

    if (!matched.ok) {
      return matched;
    }

    const recipe = matched.value;
    const context = {
      jobLevel: bench.jobLevel,
      skillId: bench.skillId,
      ingredientCount: recipe.ingredients.length,
    };

    if (!fitsInGrid(context)) {
      return { ok: false, reason: "recipe-too-large" };
    }

    const success = rollCraft(context, Math.random());
    const experience = craftExperience(context);

    const committed = await this.txHost.withTransaction(async () => {
      // Re-read inside the transaction: the stacks were matched outside it,
      // and a concurrent equip or trade could have moved them since.
      const held = await this.inventory.findByPlayer(bench.characterId);
      const byId = new Map(held.map((row) => [row.id, row]));

      for (const [itemId, quantity] of Object.entries(bench.slots)) {
        const row = byId.get(itemId);

        if (!row || row.position >= 0 || row.quantity < quantity) {
          return null;
        }
      }

      const removed: { id: string; left: number }[] = [];

      for (const [itemId, quantity] of Object.entries(bench.slots)) {
        const row = byId.get(itemId) as ItemRow;
        const left = row.quantity - quantity;

        if (left <= 0) {
          await this.inventory.deleteItem(itemId);
        } else {
          await this.inventory.updateQuantity(itemId, left);
        }

        removed.push({ id: itemId, left });
      }

      let produced: ItemRow | null = null;

      if (success) {
        const template = await this.inventory.findTemplate(recipe.resultItemId);

        if (!template) {
          this.logger.warn(
            `craft: recipe ${recipe.resultItemId} has no item template`
          );
          return null;
        }

        produced = await this.inventory.insertItem({
          playerId: bench.characterId,
          templateId: recipe.resultItemId,
          quantity: 1,
          effects: rollItemEffects(template.effects),
        });
      }

      // Paid on a failure too — 1.29's own rule, and the reason a red
      // recipe is still worth attempting.
      const gain = await this.jobs.addExperience(
        bench.characterId,
        bench.jobId,
        experience
      );

      return { removed, produced, gain };
    });

    if (!committed) {
      return { ok: false, reason: "not-enough" };
    }

    for (const { id, left } of committed.removed) {
      if (left <= 0) {
        this.inventoryFrames.sendItemRemove(bench.sessionId, id);
      } else {
        this.inventoryFrames.sendItemQuantity(bench.sessionId, id, left);
      }
    }

    if (committed.produced) {
      this.inventoryFrames.sendItemAdd(bench.sessionId, committed.produced);
    }

    bench.slots = {};
    bench.lastResultItemId = recipe.resultItemId;

    this.frames.craftResult(bench.sessionId, success);

    if (committed.gain) {
      await this.jobs.announceGain(
        bench.sessionId,
        bench.characterId,
        committed.gain
      );
    }

    // Pods changed, and so did the purse-adjacent half of the sheet.
    await this.stats.sendStats(bench.sessionId, bench.characterId);

    return { ok: true, success };
  }

  /**
   * Which recipe is on the bench.
   *
   * A recipe is a multiset of templates and counts, and the bench holds
   * *stacks*, so the comparison is on the grouped totals. 1.29 requires an
   * exact match — no spare ingredient, no missing one — which is what makes
   * this a lookup rather than a search.
   */
  private async matchRecipe(
    bench: CraftState
  ): Promise<{ ok: true; value: Recipe } | { ok: false; reason: CraftDenial }> {
    const laid = Object.entries(bench.slots);

    if (laid.length === 0) {
      return { ok: false, reason: "empty-bench" };
    }

    const held = await this.inventory.findByPlayer(bench.characterId);
    const byId = new Map(held.map((row) => [row.id, row]));
    const onBench = new Map<number, number>();

    for (const [itemId, quantity] of laid) {
      const row = byId.get(itemId);

      if (!row) {
        return { ok: false, reason: "not-found" };
      }

      onBench.set(
        row.templateId,
        (onBench.get(row.templateId) ?? 0) + quantity
      );
    }

    for (const recipe of await this.recipes.findBySkill(bench.skillId)) {
      if (recipe.ingredients.length !== onBench.size) {
        continue;
      }

      const matches = recipe.ingredients.every(
        (ingredient) => onBench.get(ingredient.itemId) === ingredient.quantity
      );

      if (matches) {
        return { ok: true, value: recipe };
      }
    }

    return { ok: false, reason: "no-such-recipe" };
  }

  /**
   * Re-lay the same recipe from what is left in the bag, for the next round
   * of a series. Returns false when the ingredients have run out, which is
   * how a series ends on its own.
   */
  private async refill(bench: CraftState, recipe: Recipe): Promise<boolean> {
    const held = await this.inventory.findByPlayer(bench.characterId);
    const slots: Record<string, number> = {};

    for (const ingredient of recipe.ingredients) {
      let needed = ingredient.quantity;

      for (const row of held) {
        if (
          row.templateId !== ingredient.itemId ||
          row.position >= 0 ||
          slots[row.id] !== undefined
        ) {
          continue;
        }

        const taken = Math.min(needed, row.quantity);
        slots[row.id] = taken;
        needed -= taken;

        if (needed === 0) {
          break;
        }
      }

      if (needed > 0) {
        return false;
      }
    }

    // A refill that needed more stacks than the grid holds is not a refill.
    if (Object.keys(slots).length > bench.maxSlots) {
      return false;
    }

    bench.slots = slots;

    return true;
  }
}
