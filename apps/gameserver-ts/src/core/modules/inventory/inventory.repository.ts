import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

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

  findTemplate(templateId: number) {
    return this.txHost.tx
      .selectFrom("itemTemplates")
      .selectAll()
      .where("id", "=", templateId)
      .executeTakeFirst();
  }
}
