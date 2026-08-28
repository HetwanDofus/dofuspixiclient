import type { ItemEffect } from "@modules/inventory/item-effects";
import type { ItemOwner } from "@modules/items/item-owner";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, ItemRow } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { sql } from "kysely";

/**
 * The unstacked-in-a-bag slot. `items.position` is a slot index for worn
 * gear and this sentinel for everything else — including everything in
 * a bank, a chest or a stall, none of which have slots.
 */
export const BAG_POSITION = -1;

export interface ItemStackGrant {
  owner: ItemOwner;
  templateId: number;
  quantity: number;
  effects: ItemEffect[];
}

/**
 * Reads and writes on `items`, for any owner.
 *
 * Every mutation here carries its precondition **inside** the statement
 * and reports the rows it touched, so a caller learns "someone got there
 * first" from a count rather than from a stale read. That is the house
 * pattern, set by `PlayersRepository.spendKamas` after QA-077, and it is
 * why this server still contains no `SELECT ... FOR UPDATE`.
 */
@Injectable()
export class ItemsRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  findByOwner(owner: ItemOwner): Promise<ItemRow[]> {
    return this.txHost.tx
      .selectFrom("items")
      .selectAll()
      .where("ownerKind", "=", owner.kind)
      .where("ownerId", "=", owner.id)
      .execute();
  }

  /** One stack, but only if `owner` really holds it. */
  findOwned(owner: ItemOwner, itemId: string): Promise<ItemRow | undefined> {
    return this.txHost.tx
      .selectFrom("items")
      .selectAll()
      .where("id", "=", itemId)
      .where("ownerKind", "=", owner.kind)
      .where("ownerId", "=", owner.id)
      .executeTakeFirst();
  }

  /**
   * Hand a whole stack to another owner without touching its id — the
   * only path on which an item keeps its identity across a move.
   *
   * The `NOT EXISTS` clause is what makes this safe to attempt
   * speculatively: when the destination already holds an identical
   * stack the statement matches **nothing** instead of violating
   * `items_stack`, so the caller can fall through to split-and-merge
   * inside the same transaction rather than having to unwind it.
   *
   * Two concurrent relocations of *different* source stacks onto the
   * same destination key can still collide on the index — the second
   * one raises, its transaction rolls back, and nothing is duplicated
   * or lost. `ItemTransferService` reports that as a retryable conflict.
   */
  async relocateWholeStack(
    from: ItemOwner,
    to: ItemOwner,
    itemId: string,
    quantity: number
  ): Promise<boolean> {
    const result = await sql<{ id: string }>`
      UPDATE items AS src
         SET owner_kind = ${to.kind}, owner_id = ${to.id}
       WHERE src.id = ${itemId}
         AND src.owner_kind = ${from.kind}
         AND src.owner_id = ${from.id}
         AND src.quantity = ${quantity}
         AND src.position = ${BAG_POSITION}
         AND NOT EXISTS (
           SELECT 1
             FROM items AS dst
            WHERE dst.owner_kind = ${to.kind}
              AND dst.owner_id = ${to.id}
              AND dst.template_id = src.template_id
              AND dst.effects_hash = src.effects_hash
              AND dst.position = ${BAG_POSITION}
         )
      RETURNING src.id
    `.execute(this.txHost.tx);

    return result.rows.length === 1;
  }

  /**
   * Take `quantity` off a stack, or `undefined` when the stack is gone,
   * no longer owned by `owner`, or too small — the three ways a
   * concurrent move beats this one.
   *
   * Two statements rather than one because `items.quantity` carries a
   * `CHECK (quantity > 0)`: draining a stack has to delete the row, not
   * write a zero into it. Their predicates are mutually exclusive
   * (`> quantity` against `= quantity`), so exactly one can ever match
   * and neither needs a lock to stay honest.
   */
  async take(
    owner: ItemOwner,
    itemId: string,
    quantity: number
  ): Promise<{ remaining: number } | undefined> {
    const decreased = await this.txHost.tx
      .updateTable("items")
      .set((eb) => ({ quantity: eb("quantity", "-", quantity) }))
      .where("id", "=", itemId)
      .where("ownerKind", "=", owner.kind)
      .where("ownerId", "=", owner.id)
      .where("quantity", ">", quantity)
      .returning("quantity")
      .executeTakeFirst();

    if (decreased) {
      return { remaining: decreased.quantity };
    }

    const drained = await this.txHost.tx
      .deleteFrom("items")
      .where("id", "=", itemId)
      .where("ownerKind", "=", owner.kind)
      .where("ownerId", "=", owner.id)
      .where("quantity", "=", quantity)
      .returning("id")
      .executeTakeFirst();

    return drained ? { remaining: 0 } : undefined;
  }

  /**
   * Add a stack to an owner's bag, merging into an identical one when it
   * exists.
   *
   * `ON CONFLICT` on `items_stack` is doing the work that
   * `InventoryRepository.insertItem`'s read-then-write used to do
   * unsafely: two concurrent grants can no longer both decide there is
   * no stack and both insert, because the second one is turned into an
   * increment by the index itself.
   */
  async give(grant: ItemStackGrant): Promise<ItemRow> {
    // `JSON.stringify`, not the array itself. node-postgres encodes a JS
    // array as a *Postgres array literal*, so a `jsonb` parameter given
    // `[]` stores the empty **object** `{}` and one given a populated
    // list fails outright with "invalid input syntax for type json".
    //
    // The `{}` is the nastier half: it is silent, and it hashes
    // differently from the `[]` every other row carries, so
    // `items_stack` stops recognising two identical stacks as identical
    // and a resource splits in two every time it crosses a container.
    // A text parameter is cast to jsonb by Postgres and round-trips
    // exactly. Same reason `dev-seed.ts` has always stringified.
    const effects = JSON.stringify(
      grant.effects
    ) as unknown as ItemRow["effects"];

    return await this.txHost.tx
      .insertInto("items")
      .values({
        ownerKind: grant.owner.kind,
        ownerId: grant.owner.id,
        templateId: grant.templateId,
        position: BAG_POSITION,
        quantity: grant.quantity,
        effects,
      })
      .onConflict((oc) =>
        oc
          .columns(["ownerKind", "ownerId", "templateId", "effectsHash"])
          .where("position", "=", BAG_POSITION)
          .doUpdateSet((eb) => ({
            quantity: eb("items.quantity", "+", grant.quantity),
          }))
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
