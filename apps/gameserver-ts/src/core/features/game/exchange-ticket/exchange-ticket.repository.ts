import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class ExchangeTicketRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  redeem(ticket: string, gameServerId: number) {
    return this.txHost.tx
      .updateTable("authTickets")
      .set({ usedAt: new Date() })
      .where("ticket", "=", ticket)
      .where("gameServerId", "=", gameServerId)
      .where("usedAt", "is", null)
      .where("expiresAt", ">", new Date())
      .returning("accountId")
      .executeTakeFirst();
  }
}
