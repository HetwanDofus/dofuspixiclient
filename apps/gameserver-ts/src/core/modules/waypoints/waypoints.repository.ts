import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class WaypointsRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  findByMapId(mapId: number) {
    return this.txHost.tx
      .selectFrom("waypoints")
      .selectAll()
      .where("mapId", "=", mapId)
      .executeTakeFirst();
  }

  findById(waypointId: string) {
    return this.txHost.tx
      .selectFrom("waypoints")
      .selectAll()
      .where("id", "=", waypointId)
      .executeTakeFirst();
  }

  findAllByKind(kind: number) {
    return this.txHost.tx
      .selectFrom("waypoints")
      .selectAll()
      .where("kind", "=", kind)
      .execute();
  }

  async knownByPlayer(playerId: string) {
    return this.txHost.tx
      .selectFrom("waypointKnown")
      .innerJoin("waypoints", "waypoints.id", "waypointKnown.waypointId")
      .innerJoin("maps", "maps.id", "waypoints.mapId")
      .select([
        "waypoints.id",
        "waypoints.mapId",
        "waypoints.cellId",
        "waypoints.kind",
        "waypoints.costKamas",
        "maps.x",
        "maps.y",
      ])
      .where("waypointKnown.playerId", "=", playerId)
      .execute();
  }

  async isKnown(playerId: string, waypointId: string): Promise<boolean> {
    const row = await this.txHost.tx
      .selectFrom("waypointKnown")
      .select("waypointId")
      .where("playerId", "=", playerId)
      .where("waypointId", "=", waypointId)
      .executeTakeFirst();
    return row !== undefined;
  }

  async discover(playerId: string, waypointId: string): Promise<void> {
    await this.txHost.tx
      .insertInto("waypointKnown")
      .values({ playerId, waypointId })
      .onConflict((oc) => oc.columns(["playerId", "waypointId"]).doNothing())
      .execute();
  }
}
