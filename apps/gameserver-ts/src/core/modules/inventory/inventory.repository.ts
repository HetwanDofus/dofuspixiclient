import type { ItemEffect } from "@modules/inventory/item-effects";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, PlayerItemRow } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

/**
 * The unequipped-inventory slot. `player_items.position` is a slot index
 * for worn gear and this sentinel for everything in the bag.
 */
export const INVENTORY_POSITION = -1;

export interface ItemGrant {
  playerId: string;
  templateId: number;
  quantity: number;
  effects: ItemEffect[];
}

@Injectable()
export class InventoryRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  findByPlayer(playerId: string) {
    return this.txHost.tx
      .selectFrom("playerItems")
      .selectAll()
      .where("playerId", "=", playerId)
      .execute();
  }

  findById(itemId: string) {
    return this.txHost.tx
      .selectFrom("playerItems")
      .selectAll()
      .where("id", "=", itemId)
      .executeTakeFirst();
  }

  findEquipped(playerId: string) {
    return this.txHost.tx
      .selectFrom("playerItems")
      .selectAll()
      .where("playerId", "=", playerId)
      .where("position", ">=", 0)
      .execute();
  }

  async moveItem(itemId: string, position: number): Promise<void> {
    await this.txHost.tx
      .updateTable("playerItems")
      .set({ position })
      .where("id", "=", itemId)
      .execute();
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.txHost.tx
      .deleteFrom("playerItems")
      .where("id", "=", itemId)
      .execute();
  }

  async updateQuantity(itemId: string, quantity: number): Promise<void> {
    await this.txHost.tx
      .updateTable("playerItems")
      .set({ quantity })
      .where("id", "=", itemId)
      .execute();
  }

  /**
   * Create an item on a character, stacking onto an identical bag stack
   * when one exists.
   *
   * This is the project's first write to `player_items`. Nothing had ever
   * created an item before QA-060, so loot, merchants, exchanges and the
   * bank will all end up here — which is why it takes a whole `ItemGrant`
   * rather than positional arguments, and why it returns the resulting
   * row: every caller needs the row's id to tell the client about it.
   *
   * Stacking is keyed on template **and** rolled effects: two Gelano with
   * different jets are different objects and must not merge into one
   * stack, or one of the two rolls silently disappears. Equipped items
   * (`position >= 0`) never stack — the grant always lands in the bag.
   *
   * The caller is expected to already be inside a transaction; the
   * read-then-write here is not atomic on its own.
   */
  async insertItem(grant: ItemGrant): Promise<PlayerItemRow> {
    const serialized = JSON.stringify(grant.effects);

    const existing = await this.txHost.tx
      .selectFrom("playerItems")
      .selectAll()
      .where("playerId", "=", grant.playerId)
      .where("templateId", "=", grant.templateId)
      .where("position", "=", INVENTORY_POSITION)
      .execute();

    const stack = existing.find(
      (row) => JSON.stringify(row.effects ?? []) === serialized
    );

    if (stack) {
      const quantity = stack.quantity + grant.quantity;

      await this.updateQuantity(stack.id, quantity);

      return { ...stack, quantity };
    }

    return await this.txHost.tx
      .insertInto("playerItems")
      .values({
        playerId: grant.playerId,
        templateId: grant.templateId,
        position: INVENTORY_POSITION,
        quantity: grant.quantity,
        effects: JSON.parse(serialized),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findTemplate(templateId: number) {
    return this.txHost.tx
      .selectFrom("itemTemplates")
      .selectAll()
      .where("id", "=", templateId)
      .executeTakeFirst();
  }
}
