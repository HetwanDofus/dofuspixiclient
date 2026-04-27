import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class MonstersRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  groupsOnMap(mapId: number) {
    return this.txHost.tx
      .selectFrom("monsterGroups")
      .selectAll()
      .where("mapId", "=", mapId)
      .execute();
  }

  template(templateId: number) {
    return this.txHost.tx
      .selectFrom("monsterTemplates")
      .selectAll()
      .where("id", "=", templateId)
      .executeTakeFirst();
  }

  level(monsterId: number, level: number) {
    return this.txHost.tx
      .selectFrom("monsterLevels")
      .selectAll()
      .where("monsterId", "=", monsterId)
      .where("level", "=", level)
      .executeTakeFirst();
  }
}
