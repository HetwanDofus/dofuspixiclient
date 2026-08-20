import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class MapsRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  findById(mapId: number) {
    return this.txHost.tx
      .selectFrom("maps")
      .select([
        "id",
        "date",
        "key",
        "width",
        "height",
        "background",
        "musicId",
        "ambianceId",
        "cells",
        "x",
        "y",
        "subareaId",
      ])
      .where("id", "=", mapId)
      .executeTakeFirst();
  }

  findMonsterConfig(mapId: number) {
    return this.txHost.tx
      .selectFrom("maps")
      .select(["monstersRaw", "numgroup", "mobSizeMin", "mobSizeMax"])
      .where("id", "=", mapId)
      .executeTakeFirst();
  }

  findNeighborInDirection(mapId: number, direction: number) {
    return this.txHost.tx
      .selectFrom("mapNeighbors")
      .select(["neighborMapId"])
      .where("mapId", "=", mapId)
      .where("direction", "=", direction)
      .executeTakeFirst();
  }

  findFightPlaces(mapId: number) {
    return this.txHost.tx
      .selectFrom("mapFightPlaces")
      .select(["places0", "places1"])
      .where("mapId", "=", mapId)
      .executeTakeFirst();
  }
}
