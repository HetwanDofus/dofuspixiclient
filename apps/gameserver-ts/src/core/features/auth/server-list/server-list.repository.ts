import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class ServerListRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  listForAccount(accountId: string) {
    return this.txHost.tx
      .selectFrom("gameServers")
      .leftJoin("accountServers", (join) =>
        join
          .onRef("accountServers.serverId", "=", "gameServers.id")
          .on("accountServers.accountId", "=", accountId)
      )
      .select([
        "gameServers.id as serverId",
        "gameServers.state",
        "gameServers.onlinePlayers",
        "gameServers.maxPlayers",
        "accountServers.characterCount",
      ])
      .execute();
  }
}
