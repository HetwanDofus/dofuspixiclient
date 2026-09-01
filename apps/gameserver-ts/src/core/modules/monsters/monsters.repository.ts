import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

export interface MonsterDropWithType {
  monsterId: number;
  itemTemplateId: number;
  rate: number;
  minQuantity: number;
  maxQuantity: number;
  /** `item_templates.type`; raw meat is 63. */
  itemType: number;
}

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

  /**
   * Drop table for a set of monster templates, in one query.
   *
   * A fight resolves loot for every defeated monster at once, so this
   * takes the whole id set rather than being called per monster —
   * a 8-mob group would otherwise issue 8 round-trips at the exact
   * moment the client is waiting on the end-of-fight frame.
   *
   * `rate` is a percentage (a double), not a 0..1 probability: the world
   * importer writes StarLoco's `percentGradeN` straight through.
   */
  dropsFor(monsterIds: readonly number[]) {
    if (monsterIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.txHost.tx
      .selectFrom("monsterDrops")
      .innerJoin(
        "itemTemplates",
        "itemTemplates.id",
        "monsterDrops.itemTemplateId"
      )
      .select([
        "monsterDrops.monsterId",
        "monsterDrops.itemTemplateId",
        "monsterDrops.rate",
        "monsterDrops.minQuantity",
        "monsterDrops.maxQuantity",
        "itemTemplates.type as itemType",
      ])
      .where("monsterId", "in", [...monsterIds])
      .execute() as Promise<MonsterDropWithType[]>;
  }
}
