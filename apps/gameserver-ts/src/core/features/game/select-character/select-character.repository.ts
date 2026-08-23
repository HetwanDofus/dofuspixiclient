import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class SelectCharacterRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  load(characterId: string, accountId: string, serverId: number) {
    return this.txHost.tx
      .selectFrom("players")
      .leftJoin("playerColors", "playerColors.playerId", "players.id")
      .where("players.id", "=", characterId)
      .where("players.accountId", "=", accountId)
      .where("players.serverId", "=", serverId)
      .where("players.deletedAt", "is", null)
      .select([
        "players.id",
        "players.name",
        "players.level",
        "players.sex",
        "players.gfx",
        "playerColors.color1",
        "playerColors.color2",
        "playerColors.color3",
      ])
      .executeTakeFirst();
  }
}
