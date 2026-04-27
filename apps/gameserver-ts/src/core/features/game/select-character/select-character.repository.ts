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
      .innerJoin("playerStats", "playerStats.playerId", "players.id")
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
        "players.experience",
        "players.kamas",
        "players.life",
        "players.energy",
        "players.statsPoints",
        "players.spellPoints",
        "playerStats.strength",
        "playerStats.vitality",
        "playerStats.wisdom",
        "playerStats.intelligence",
        "playerStats.chance",
        "playerStats.agility",
        "playerColors.color1",
        "playerColors.color2",
        "playerColors.color3",
      ])
      .executeTakeFirst();
  }
}
