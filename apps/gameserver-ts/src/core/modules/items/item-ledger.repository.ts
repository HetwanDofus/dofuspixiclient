import type { ItemOwner } from "@modules/items/item-owner";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

export interface LedgerEntry {
  txId: string;
  actorCharacterId: string | null;
  from: ItemOwner;
  to: ItemOwner;
  itemId?: string | null;
  templateId?: number | null;
  quantity?: number;
  kamas?: bigint | number;
  exchangeKind?: number | null;
  exchangeSessionId?: string | null;
}

/**
 * Who moved what, where from and where to.
 *
 * Written inside the transaction that performs the move, so a ledger
 * line exists if and only if the move committed. That is the property
 * that makes it worth having: a log written next to a transaction can
 * describe things that never happened, and then it cannot be used to
 * settle an argument about whether an item was duplicated.
 */
@Injectable()
export class ItemLedgerRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  async record(entry: LedgerEntry): Promise<void> {
    await this.txHost.tx
      .insertInto("itemLedger")
      .values({
        txId: entry.txId,
        actorCharacterId: entry.actorCharacterId,
        itemId: entry.itemId ?? null,
        templateId: entry.templateId ?? null,
        quantity: entry.quantity ?? 0,
        kamas: String(entry.kamas ?? 0),
        fromKind: entry.from.kind,
        fromId: entry.from.id,
        toKind: entry.to.kind,
        toId: entry.to.id,
        exchangeKind: entry.exchangeKind ?? null,
        exchangeSessionId: entry.exchangeSessionId ?? null,
      })
      .execute();
  }
}
