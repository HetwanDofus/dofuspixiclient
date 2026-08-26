import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { sql } from "kysely";

@Injectable()
export class InteractiveObjectsRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  /** Template for a layer-2 gfx id — name, type and the skills it offers. */
  findTemplate(gfxId: number) {
    return this.txHost.tx
      .selectFrom("interactiveObjectsTemplates")
      .select(["id", "name", "type", "skills"])
      .where("id", "=", gfxId)
      .executeTakeFirst();
  }

  /** The house whose door sits on this cell, with the way in. */
  findHouseByDoor(mapId: number, cellId: number) {
    return this.txHost.tx
      .selectFrom("houseDoors")
      .innerJoin("houses", "houses.id", "houseDoors.houseId")
      .select([
        "houses.id",
        "houses.entryMapId",
        "houses.entryCellId",
        "houses.locked",
        "houses.ownerId",
      ])
      .where("houseDoors.mapId", "=", mapId)
      .where("houseDoors.cellId", "=", cellId)
      .executeTakeFirst();
  }

  /**
   * The house a map belongs to, if any. This is what separates a chest in
   * someone's living room from the self-service safe that *is* the bank:
   * `houses.json` lists every interior map against its house, and the bank
   * maps are in no house at all.
   */
  findHouseByInteriorMap(mapId: number) {
    return (
      this.txHost.tx
        .selectFrom("houses")
        .select(["id", "locked", "ownerId"])
        // `@>` needs jsonb on both sides — a bare bind parameter arrives as
        // text and Postgres refuses the operator outright.
        .where(sql<boolean>`interior_map_ids @> to_jsonb(${mapId}::int)`)
        .executeTakeFirst()
    );
  }

  async countHouseStorage(houseId: string): Promise<number> {
    const row = await this.txHost.tx
      .selectFrom("houseStorageItems")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("houseId", "=", houseId)
      .executeTakeFirst();

    return Number(row?.n ?? 0);
  }

  async countAccountBank(accountId: string): Promise<number> {
    const row = await this.txHost.tx
      .selectFrom("accountBankItems")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("accountId", "=", accountId)
      .executeTakeFirst();

    return Number(row?.n ?? 0);
  }
}
