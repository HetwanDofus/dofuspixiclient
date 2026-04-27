import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { AuthTicketsTable, DB } from "@shared/db/schema";
import type { Insertable } from "kysely";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class SelectServerRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  findServer(serverId: number) {
    return this.txHost.tx
      .selectFrom("gameServers")
      .select(["id", "address", "port", "state", "onlinePlayers", "maxPlayers"])
      .where("id", "=", serverId)
      .executeTakeFirst();
  }

  async issueTicket(ticket: Insertable<AuthTicketsTable>): Promise<void> {
    await this.txHost.tx.insertInto("authTickets").values(ticket).execute();
  }
}
