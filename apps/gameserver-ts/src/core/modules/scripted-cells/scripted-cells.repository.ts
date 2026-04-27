import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class ScriptedCellsRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  find(mapId: number, cellId: number) {
    return this.txHost.tx
      .selectFrom("scriptedCells")
      .select(["verb", "actionsArgs", "conditions"])
      .where("mapId", "=", mapId)
      .where("cellId", "=", cellId)
      .executeTakeFirst();
  }
}
