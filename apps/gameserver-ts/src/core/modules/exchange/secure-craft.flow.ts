import { randomUUID } from "node:crypto";

import type { Recipe } from "@modules/exchange/craft.repository";
import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { SecureCraftState } from "@modules/exchange/secure-craft.registry";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, ItemRow } from "@shared/db/schema";
import { ExchangeType } from "@dofus/proto/common_pb";
import { CraftRepository } from "@modules/exchange/craft.repository";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { ExchangeRegistryService } from "@modules/exchange/exchange.registry";
import { SecureCraftRegistryService } from "@modules/exchange/secure-craft.registry";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { rollItemEffects } from "@modules/inventory/item-effects";
import { playerOwner } from "@modules/items/item-owner";
import { ItemTransferService } from "@modules/items/item-transfer.service";
import { KamasTransferService } from "@modules/items/kamas-transfer.service";
import {
  craftExperience,
  fitsInGrid,
  isSkillUnlocked,
  rollCraft,
} from "@modules/jobs/craft.rules";
import { JobsCatalogService } from "@modules/jobs/jobs.catalog.service";
import { craftSlotsAtLevel } from "@modules/jobs/jobs.craft-slots";
import { JobsRepository } from "@modules/jobs/jobs.repository";
import { JobsService } from "@modules/jobs/jobs.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { JobSkillKind } from "@shared/db/schema";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

export type SecureCraftDenial =
  | "self"
  | "not-in-world"
  | "target-not-found"
  | "different-map"
  | "target-busy"
  | "already-exchanging"
  | "no-session"
  | "not-target"
  | "not-the-customer"
  | "not-the-artisan"
  | "no-job"
  | "no-tool"
  | "skill-locked"
  | "not-a-craft-skill"
  | "not-found"
  | "equipped"
  | "not-enough"
  | "invalid-quantity"
  | "no-slot-left"
  | "empty-bench"
  | "no-such-recipe"
  | "recipe-too-large"
  | "pending";

export type SecureCraftResult =
  | { ok: true }
  | { ok: false; reason: SecureCraftDenial };

/** `equip-rules.ts`'s weapon slot — where a job tool is worn. */
const WEAPON_POSITION = 1;

/**
 * Crafting for somebody else — exchange types 12 and 13.
 *
 * Two windows, one deal. The customer supplies the ingredients and gets the
 * object; the artisan supplies the skill and gets the **experience**. That
 * split is the whole point of the mechanism, and it is the one thing here
 * that would be invisible if it were wrong — an artisan who received the
 * object as well would look like a working feature to anyone not counting.
 *
 * The shape is `TradeFlow`'s, not `CraftFlow`'s: one shared `lockKey` rather
 * than two locks, so the artisan's `EK` can never interleave with the
 * customer's `EMO`. What it borrows from `CraftFlow` is the rules — the same
 * `craft.rules.ts` decides slots, experience and the roll, so a co-operative
 * craft and a solo one cannot drift apart.
 *
 * **Nothing moves until the artisan crafts.** Ingredients, payment and the
 * result all commit in one transaction, so a socket dropping mid-deal has
 * nothing to undo.
 *
 * The two sides are told apart by the type each *receives*: 12 is the
 * customer's window, 13 the artisan's. Which of the two opened the deal is
 * not recorded beyond that — "Inviter à" and "Demander à" are the same
 * arrangement seen from opposite ends.
 */
@Injectable()
export class SecureCraftFlow {
  private readonly logger = new Logger(SecureCraftFlow.name);

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly crafts: SecureCraftRegistryService,
    private readonly exchanges: ExchangeRegistryService,
    private readonly frames: ExchangeFramesService,
    private readonly presence: PlayerPresenceService,
    private readonly sessions: SessionRegistry,
    private readonly fights: FightRegistryService,
    private readonly recipes: CraftRepository,
    private readonly inventory: InventoryRepository,
    private readonly inventoryFrames: InventoryFramesService,
    private readonly transfers: ItemTransferService,
    private readonly kamas: KamasTransferService,
    private readonly catalog: JobsCatalogService,
    private readonly jobsRepo: JobsRepository,
    private readonly jobs: JobsService,
    private readonly players: PlayersRepository,
    private readonly stats: StatsService
  ) {}

  /** The deal this session belongs to, if any. */
  craftOf(session: ExchangeSession): SecureCraftState | undefined {
    return session.tradeId ? this.crafts.get(session.tradeId) : undefined;
  }

  /**
   * `ER12` / `ER13` — one player proposes the arrangement to another.
   *
   * `asArtisan` is which end the *initiator* is standing at: type 13 is the
   * artisan inviting a customer, type 12 the customer asking an artisan.
   * Everything after this point is symmetric.
   */
  async request(
    session: { sessionId: string; accountId: string; characterId: string },
    targetCharacterId: string,
    skillId: number,
    asArtisan: boolean
  ): Promise<SecureCraftResult> {
    if (targetCharacterId === session.characterId) {
      return { ok: false, reason: "self" };
    }

    const me = this.presence.getByCharacter(session.characterId);
    const them = this.presence.getByCharacter(targetCharacterId);

    if (!me) {
      return { ok: false, reason: "not-in-world" };
    }

    if (!them) {
      return { ok: false, reason: "target-not-found" };
    }

    // The map, not the distance — the same rule `TradeFlow` applies, and
    // for the same reason: nothing else outside a fight checks adjacency
    // (QA-114), and inventing it here would make this stricter than talking
    // to a banker. The bench the artisan is supposed to be standing at is
    // part of that same unwritten rule.
    if (me.mapId !== them.mapId) {
      return { ok: false, reason: "different-map" };
    }

    if (
      this.exchanges.has(them.sessionId) ||
      this.fights.isInFight(them.sessionId)
    ) {
      return { ok: false, reason: "target-busy" };
    }

    const artisan = asArtisan
      ? {
          sessionId: session.sessionId,
          characterId: session.characterId,
          name: me.name,
        }
      : {
          sessionId: them.sessionId,
          characterId: targetCharacterId,
          name: them.name,
        };
    const customer = asArtisan
      ? {
          sessionId: them.sessionId,
          characterId: targetCharacterId,
          name: them.name,
        }
      : {
          sessionId: session.sessionId,
          characterId: session.characterId,
          name: me.name,
        };

    const ready = await this.artisanCan(artisan.characterId, skillId);

    if (!ready.ok) {
      return ready;
    }

    const craftId = randomUUID();

    this.crafts.open({
      craftId,
      mapId: me.mapId,
      skillId,
      jobId: ready.jobId,
      jobLevel: ready.level,
      maxSlots: craftSlotsAtLevel(ready.level),
      artisan,
      customer,
      slots: {},
      payItems: {},
      payKamas: "0",
      accepted: false,
      crafted: 0,
    });

    for (const [side, kind] of [
      [customer, ExchangeType.EXCHANGE_SECURE_CRAFT_CLIENT],
      [artisan, ExchangeType.EXCHANGE_SECURE_CRAFT_ARTISAN],
    ] as const) {
      this.exchanges.open({
        sessionId: side.sessionId,
        characterId: side.characterId,
        accountId: this.accountOf(side.sessionId),
        kind,
        remote: playerOwner(
          side.characterId === artisan.characterId
            ? customer.characterId
            : artisan.characterId
        ),
        phase: "pending",
        // The shared key: one queue, not two locks.
        lockKey: craftId,
        tradeId: craftId,
        openedAt: Date.now(),
      });
    }

    this.frames.request(
      [session.sessionId, them.sessionId],
      { id: session.characterId, name: me.name },
      { id: targetCharacterId, name: them.name },
      asArtisan
        ? ExchangeType.EXCHANGE_SECURE_CRAFT_ARTISAN
        : ExchangeType.EXCHANGE_SECURE_CRAFT_CLIENT
    );

    this.logger.log(
      `secure craft ${craftId}: ${artisan.characterId} works for ` +
        `${customer.characterId} (skill ${skillId})`
    );

    return { ok: true };
  }

  /** `EA` — the invited side says yes, and both windows open. */
  accept(session: ExchangeSession): SecureCraftResult {
    const craft = this.craftOf(session);

    if (!craft) {
      return { ok: false, reason: "no-session" };
    }

    if (craft.accepted) {
      return { ok: true };
    }

    craft.accepted = true;

    for (const [side, kind] of [
      [craft.customer, ExchangeType.EXCHANGE_SECURE_CRAFT_CLIENT],
      [craft.artisan, ExchangeType.EXCHANGE_SECURE_CRAFT_ARTISAN],
    ] as const) {
      const open = this.exchanges.get(side.sessionId);

      if (open) {
        open.phase = "open";
      }

      this.frames.openCraft(side.sessionId, kind);
    }

    return { ok: true };
  }

  /**
   * `EMO` — the customer lays an ingredient.
   *
   * Only the customer may: the ingredients are theirs, and an artisan able
   * to put their own stock on the bench would be doing a solo craft with
   * somebody else's experience.
   */
  async moveItem(
    session: ExchangeSession,
    add: boolean,
    itemId: string,
    quantity: number
  ): Promise<SecureCraftResult> {
    const craft = this.craftOf(session);

    if (!craft) {
      return { ok: false, reason: "no-session" };
    }

    if (session.sessionId !== craft.customer.sessionId) {
      return { ok: false, reason: "not-the-customer" };
    }

    return this.lay(
      craft,
      craft.slots,
      craft.maxSlots,
      add,
      itemId,
      quantity,
      false
    );
  }

  /** `EPO` — the customer offers an item in payment. */
  async movePayItem(
    session: ExchangeSession,
    add: boolean,
    itemId: string,
    quantity: number
  ): Promise<SecureCraftResult> {
    const craft = this.craftOf(session);

    if (!craft) {
      return { ok: false, reason: "no-session" };
    }

    if (session.sessionId !== craft.customer.sessionId) {
      return { ok: false, reason: "not-the-customer" };
    }

    // The payment pile has no grid: it is not a recipe.
    return this.lay(
      craft,
      craft.payItems,
      Number.POSITIVE_INFINITY,
      add,
      itemId,
      quantity,
      true
    );
  }

  /** `EPG` — the customer offers kamas. Absolute, like a trade's. */
  async movePayKamas(
    session: ExchangeSession,
    amount: bigint
  ): Promise<SecureCraftResult> {
    const craft = this.craftOf(session);

    if (!craft) {
      return { ok: false, reason: "no-session" };
    }

    if (session.sessionId !== craft.customer.sessionId) {
      return { ok: false, reason: "not-the-customer" };
    }

    if (amount < 0n) {
      return { ok: false, reason: "invalid-quantity" };
    }

    // Clamped to the purse rather than refused, which is what the canonical
    // client does on its side (`validateKama`). An offer of more than one
    // has is a slip, not an attack, and the commit would refuse it anyway.
    const purse = BigInt(
      (await this.players.findById(craft.customer.characterId))?.kamas ?? 0
    );
    const clamped = amount > purse ? purse : amount;

    craft.payKamas = String(clamped);

    this.frames.payKamas(
      craft.customer.sessionId,
      craft.artisan.sessionId,
      clamped
    );

    return { ok: true };
  }

  /**
   * `EK` — the artisan makes it.
   *
   * The one asymmetry that matters: the object goes to the customer, the
   * experience to the artisan, and the payment the other way. All four
   * movements are one transaction.
   */
  async craft(session: ExchangeSession): Promise<SecureCraftResult> {
    const craft = this.craftOf(session);

    if (!craft) {
      return { ok: false, reason: "no-session" };
    }

    if (session.sessionId !== craft.artisan.sessionId) {
      return { ok: false, reason: "not-the-artisan" };
    }

    if (!craft.accepted) {
      return { ok: false, reason: "pending" };
    }

    // Re-checked here, not only at request time: a deal can sit on screen
    // for as long as the two like, and unequipping the tool in the meantime
    // is entirely ordinary.
    const ready = await this.artisanCan(
      craft.artisan.characterId,
      craft.skillId
    );

    if (!ready.ok) {
      return ready;
    }

    const matched = await this.matchRecipe(craft);

    if (!matched.ok) {
      return matched;
    }

    const recipe = matched.value;
    const context = {
      jobLevel: craft.jobLevel,
      skillId: craft.skillId,
      ingredientCount: recipe.ingredients.length,
    };

    if (!fitsInGrid(context)) {
      return { ok: false, reason: "recipe-too-large" };
    }

    const success = rollCraft(context, Math.random());
    const experience = craftExperience(context);

    const committed = await this.txHost.withTransaction(async () => {
      const held = await this.inventory.findByPlayer(
        craft.customer.characterId
      );
      const byId = new Map(held.map((row) => [row.id, row]));

      for (const [itemId, quantity] of Object.entries(craft.slots)) {
        const row = byId.get(itemId);

        if (!row || row.position >= 0 || row.quantity < quantity) {
          return null;
        }
      }

      const consumed: { id: string; left: number }[] = [];

      for (const [itemId, quantity] of Object.entries(craft.slots)) {
        const row = byId.get(itemId) as ItemRow;
        const left = row.quantity - quantity;

        if (left <= 0) {
          await this.inventory.deleteItem(itemId);
        } else {
          await this.inventory.updateQuantity(itemId, left);
        }

        consumed.push({ id: itemId, left });
      }

      let produced: ItemRow | null = null;

      if (success) {
        const template = await this.inventory.findTemplate(recipe.resultItemId);

        if (!template) {
          return null;
        }

        // To the **customer**. This line is the mechanism.
        produced = await this.inventory.insertItem({
          playerId: craft.customer.characterId,
          templateId: recipe.resultItemId,
          quantity: 1,
          effects: rollItemEffects(template.effects),
        });
      }

      // To the **artisan**, and on a failure too — same rule as a solo
      // craft, and the reason an artisan will take a red recipe on.
      const gain = await this.jobs.addExperience(
        craft.artisan.characterId,
        craft.jobId,
        experience
      );

      const paid = await this.settle(craft);

      if (!paid) {
        return null;
      }

      return { consumed, produced, gain };
    });

    if (!committed) {
      return { ok: false, reason: "not-enough" };
    }

    for (const { id, left } of committed.consumed) {
      if (left <= 0) {
        this.inventoryFrames.sendItemRemove(craft.customer.sessionId, id);
      } else {
        this.inventoryFrames.sendItemQuantity(
          craft.customer.sessionId,
          id,
          left
        );
      }
    }

    if (committed.produced) {
      this.inventoryFrames.sendItemAdd(
        craft.customer.sessionId,
        committed.produced
      );
    }

    craft.slots = {};
    craft.payItems = {};
    craft.payKamas = "0";
    craft.crafted++;

    for (const side of [craft.customer, craft.artisan]) {
      this.frames.craftResult(side.sessionId, success);
      await this.stats.sendStats(side.sessionId, sideCharacter(craft, side));
    }

    if (committed.gain) {
      await this.jobs.announceGain(
        craft.artisan.sessionId,
        craft.artisan.characterId,
        committed.gain
      );
    }

    return { ok: true };
  }

  /**
   * Close the deal for both sides.
   *
   * Nothing has moved that is not already committed, so this is a teardown
   * and never a rollback.
   */
  close(craft: SecureCraftState, completed: boolean): void {
    for (const side of [craft.customer, craft.artisan]) {
      this.exchanges.close(side.sessionId);

      if (this.sessions.get(side.sessionId)) {
        this.frames.leave(side.sessionId, completed);
      }
    }

    this.crafts.close(craft.craftId);
  }

  /** The artisan holds the job, its tool, and the skill is open to them. */
  private async artisanCan(
    characterId: string,
    skillId: number
  ): Promise<
    | { ok: true; jobId: number; level: number }
    | { ok: false; reason: SecureCraftDenial }
  > {
    await this.catalog.load();

    const skill = this.catalog.skill(skillId);

    if (!skill || skill.kind !== JobSkillKind.Craft) {
      return { ok: false, reason: "not-a-craft-skill" };
    }

    const held = await this.jobsRepo.findPlayerJob(characterId, skill.jobId);

    if (!held) {
      return { ok: false, reason: "no-job" };
    }

    if (!isSkillUnlocked(skillId, held.level)) {
      return { ok: false, reason: "skill-locked" };
    }

    const equipped = await this.inventory.findEquipped(characterId);
    const weapon = equipped.find((row) => row.position === WEAPON_POSITION);

    if (!weapon || !this.catalog.isToolOf(weapon.templateId, skill.jobId)) {
      return { ok: false, reason: "no-tool" };
    }

    return { ok: true, jobId: skill.jobId, level: held.level };
  }

  /** Lay or take back one stack, on the bench or on the payment pile. */
  private async lay(
    craft: SecureCraftState,
    pile: Record<string, number>,
    limit: number,
    add: boolean,
    itemId: string,
    quantity: number,
    isPayment: boolean
  ): Promise<SecureCraftResult> {
    const item = await this.inventory.findOwned(
      craft.customer.characterId,
      itemId
    );

    if (!item) {
      return { ok: false, reason: "not-found" };
    }

    const echo = (row: ItemRow, added: boolean) => {
      if (isPayment) {
        this.frames.payItem(
          craft.customer.sessionId,
          craft.artisan.sessionId,
          added,
          row
        );
      } else {
        this.frames.coopItem(
          craft.customer.sessionId,
          craft.artisan.sessionId,
          added,
          row
        );
      }
    };

    if (!add) {
      delete pile[itemId];
      echo(item, false);
      return { ok: true };
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, reason: "invalid-quantity" };
    }

    if (item.position >= 0) {
      return { ok: false, reason: "equipped" };
    }

    if (quantity > item.quantity) {
      return { ok: false, reason: "not-enough" };
    }

    const wouldOccupy =
      pile[itemId] === undefined
        ? Object.keys(pile).length + 1
        : Object.keys(pile).length;

    if (wouldOccupy > limit) {
      return { ok: false, reason: "no-slot-left" };
    }

    pile[itemId] = quantity;
    echo({ ...item, quantity }, true);

    return { ok: true };
  }

  /** Move the payment from the customer to the artisan. */
  private async settle(craft: SecureCraftState): Promise<boolean> {
    for (const [itemId, quantity] of Object.entries(craft.payItems)) {
      const result = await this.transfers.transfer({
        from: playerOwner(craft.customer.characterId),
        to: playerOwner(craft.artisan.characterId),
        itemId,
        quantity,
        actorCharacterId: craft.customer.characterId,
        exchangeKind: ExchangeType.EXCHANGE_SECURE_CRAFT_CLIENT,
        exchangeSessionId: craft.craftId,
      });

      if (!result.ok) {
        return false;
      }

      this.inventoryFrames.sendItemAdd(
        craft.artisan.sessionId,
        result.move.destination
      );
    }

    const amount = BigInt(craft.payKamas);

    if (amount > 0n) {
      const result = await this.kamas.transfer({
        from: playerOwner(craft.customer.characterId),
        to: playerOwner(craft.artisan.characterId),
        amount,
        actorCharacterId: craft.customer.characterId,
        exchangeKind: ExchangeType.EXCHANGE_SECURE_CRAFT_CLIENT,
        exchangeSessionId: craft.craftId,
      });

      if (!result.ok) {
        return false;
      }
    }

    return true;
  }

  /** Which recipe the customer has laid out; the same rule as a solo bench. */
  private async matchRecipe(
    craft: SecureCraftState
  ): Promise<
    { ok: true; value: Recipe } | { ok: false; reason: SecureCraftDenial }
  > {
    const laid = Object.entries(craft.slots);

    if (laid.length === 0) {
      return { ok: false, reason: "empty-bench" };
    }

    const held = await this.inventory.findByPlayer(craft.customer.characterId);
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

    for (const recipe of await this.recipes.findBySkill(craft.skillId)) {
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

  private accountOf(sessionId: string): string {
    return this.sessions.get(sessionId)?.accountId ?? "";
  }
}

function sideCharacter(
  craft: SecureCraftState,
  side: { sessionId: string }
): string {
  return side.sessionId === craft.artisan.sessionId
    ? craft.artisan.characterId
    : craft.customer.characterId;
}
