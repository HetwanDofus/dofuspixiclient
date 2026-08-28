import type { ItemEffect } from "@modules/inventory/item-effects";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, ItemRow } from "@shared/db/schema";
import { playerOwner } from "@modules/items/item-owner";
import { BAG_POSITION, ItemsRepository } from "@modules/items/items.repository";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

/**
 * The unequipped-inventory slot. `items.position` is a slot index for
 * worn gear and this sentinel for everything in the bag.
 *
 * Re-exported from `items` so the two names cannot drift apart; the
 * inventory has used this one since before there were other containers.
 */
export const INVENTORY_POSITION = BAG_POSITION;

export interface ItemGrant {
  playerId: string;
  templateId: number;
  quantity: number;
  effects: ItemEffect[];
}

/**
 * A character's own items — the bag and what they wear.
 *
 * Since migration 0053 this is a *view* over `items` narrowed to
 * `owner_kind = Player`: an inventory is one container among several,
 * and equipment rules, pods and shortcuts are the only things that care
 * which one. Moving a stack to any other container is
 * `ItemTransferService`, not this.
 *
 * Ownership is a predicate in every statement rather than a field the
 * caller is trusted to compare, so a request naming someone else's item
 * finds nothing instead of finding it and being told off afterwards.
 */
@Injectable()
export class InventoryRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly items: ItemsRepository
  ) {}

  findByPlayer(playerId: string): Promise<ItemRow[]> {
    return this.items.findByOwner(playerOwner(playerId));
  }

  /** One of this player's stacks — or nothing, if it is not theirs. */
  findOwned(playerId: string, itemId: string): Promise<ItemRow | undefined> {
    return this.items.findOwned(playerOwner(playerId), itemId);
  }

  findEquipped(playerId: string): Promise<ItemRow[]> {
    return this.txHost.tx
      .selectFrom("items")
      .selectAll()
      .where("ownerKind", "=", playerOwner(playerId).kind)
      .where("ownerId", "=", playerId)
      .where("position", ">=", 0)
      .execute();
  }

  async moveItem(itemId: string, position: number): Promise<void> {
    await this.txHost.tx
      .updateTable("items")
      .set({ position })
      .where("id", "=", itemId)
      .execute();
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.txHost.tx.deleteFrom("items").where("id", "=", itemId).execute();
  }

  async updateQuantity(itemId: string, quantity: number): Promise<void> {
    await this.txHost.tx
      .updateTable("items")
      .set({ quantity })
      .where("id", "=", itemId)
      .execute();
  }

  /**
   * Create an item on a character, stacking onto an identical bag stack
   * when one exists.
   *
   * The read-then-write this used to do is gone: `ItemsRepository.give`
   * inserts with `ON CONFLICT DO UPDATE` against the `items_stack`
   * index, so two concurrent grants can no longer both conclude there is
   * no stack and both insert one. That was the bug this method's own
   * comment used to warn about.
   *
   * Stacking is keyed on template **and** rolled effects: two Gelano
   * with different jets are different objects and must not merge, or one
   * of the two rolls silently disappears. Equipped items never stack —
   * the grant always lands in the bag.
   */
  insertItem(grant: ItemGrant): Promise<ItemRow> {
    return this.items.give({
      owner: playerOwner(grant.playerId),
      templateId: grant.templateId,
      quantity: grant.quantity,
      effects: grant.effects,
    });
  }

  findTemplate(templateId: number) {
    return this.txHost.tx
      .selectFrom("itemTemplates")
      .selectAll()
      .where("id", "=", templateId)
      .executeTakeFirst();
  }
}
