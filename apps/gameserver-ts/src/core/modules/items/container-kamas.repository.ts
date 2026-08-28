import type { ItemOwner } from "@modules/items/item-owner";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

/**
 * The kamas a container holds — a bank, a house chest, and later a
 * merchant's stall or a tax collector.
 *
 * Same contract as `PlayersRepository.spendKamas`: the balance predicate
 * lives inside the `UPDATE`, and a row count of zero is the refusal. The
 * `CHECK (kamas >= 0)` from migration 0054 is the backstop for the day
 * someone writes a debit that forgets it.
 */
@Injectable()
export class ContainerKamasRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  async balance(owner: ItemOwner): Promise<bigint> {
    const row = await this.txHost.tx
      .selectFrom("containerKamas")
      .select("kamas")
      .where("ownerKind", "=", owner.kind)
      .where("ownerId", "=", owner.id)
      .executeTakeFirst();

    return BigInt(row?.kamas ?? 0);
  }

  /**
   * Credit, creating the container's row on first use. Nothing else ever
   * inserts here, so there is no separate "open an account" step for a
   * caller to forget — and a chest nobody has ever used reads as zero
   * rather than as missing.
   */
  async earn(owner: ItemOwner, amount: bigint): Promise<void> {
    await this.txHost.tx
      .insertInto("containerKamas")
      .values({
        ownerKind: owner.kind,
        ownerId: owner.id,
        kamas: String(amount),
      })
      .onConflict((oc) =>
        oc.columns(["ownerKind", "ownerId"]).doUpdateSet((eb) => ({
          kamas: eb("containerKamas.kamas", "+", String(amount)),
        }))
      )
      .execute();
  }

  /** Debit. Returns the rows touched — 0 means the balance was short. */
  async spend(owner: ItemOwner, amount: bigint): Promise<number> {
    const result = await this.txHost.tx
      .updateTable("containerKamas")
      .set((eb) => ({ kamas: eb("kamas", "-", String(amount)) }))
      .where("ownerKind", "=", owner.kind)
      .where("ownerId", "=", owner.id)
      .where("kamas", ">=", String(amount))
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }
}
