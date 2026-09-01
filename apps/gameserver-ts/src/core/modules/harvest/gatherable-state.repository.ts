import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { sql } from "kysely";

/**
 * The live state of the world's placed resources.
 *
 * A row exists only once a cell has been harvested at least once: absence
 * means "available", which keeps the table proportional to what players have
 * actually touched rather than to the 12 216 resources the import found.
 *
 * Everything here is deliberately one statement. Reserving is the case that
 * matters — two clients double-clicking the same tree produce two genuinely
 * concurrent requests (`WsRouter.dispatch` is not awaited, QA-045/QA-064), so
 * the taking has to be the `UPDATE`'s own `WHERE`, not a read followed by a
 * write.
 */
@Injectable()
export class GatherableStateRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  /**
   * Takes the resource for `playerId`, or returns false because someone
   * else already has it or it has not grown back.
   *
   * `INSERT … ON CONFLICT DO UPDATE` with the availability test in the
   * conflict clause makes the first harvest of a cell and the thousandth the
   * same statement: the insert wins when no row exists, the update wins only
   * when the existing row says the resource is free.
   */
  async reserve(
    mapId: number,
    cellId: number,
    playerId: string,
    holdMs: number
  ): Promise<boolean> {
    const held = `${Math.max(0, Math.round(holdMs))} milliseconds`;

    const result = await sql<{ mapId: number }>`
      INSERT INTO gatherable_cell_states
        (map_id, cell_id, available_at, reserved_by, reserved_until)
      VALUES
        (${mapId}, ${cellId}, now(), ${playerId}, now() + ${held}::interval)
      ON CONFLICT (map_id, cell_id) DO UPDATE
        SET reserved_by    = ${playerId},
            reserved_until = now() + ${held}::interval
        WHERE gatherable_cell_states.available_at <= now()
          AND (gatherable_cell_states.reserved_until IS NULL
               OR gatherable_cell_states.reserved_until <= now())
      RETURNING map_id AS "mapId"
    `.execute(this.txHost.tx);

    return result.rows.length > 0;
  }

  /** Gives the resource back untouched — an interrupted or refused action. */
  async release(mapId: number, cellId: number, playerId: string) {
    await this.txHost.tx
      .updateTable("gatherableCellStates")
      .set({ reservedBy: null, reservedUntil: null })
      .where("mapId", "=", mapId)
      .where("cellId", "=", cellId)
      .where("reservedBy", "=", playerId)
      .execute();
  }

  /**
   * The resource was taken: it is gone until `availableAt`.
   *
   * The instant is persisted rather than left to the in-memory scheduler so
   * a restart honours it — a cold start has no handoff to restore from, and
   * re-arming from this column is what keeps a felled tree felled.
   */
  async deplete(
    mapId: number,
    cellId: number,
    playerId: string,
    respawnSeconds: number
  ): Promise<Date | null> {
    const seconds = `${Math.max(1, Math.round(respawnSeconds))} seconds`;

    const result = await sql<{ availableAt: Date }>`
      UPDATE gatherable_cell_states
         SET available_at    = now() + ${seconds}::interval,
             reserved_by     = NULL,
             reserved_until  = NULL
       WHERE map_id = ${mapId}
         AND cell_id = ${cellId}
         AND reserved_by = ${playerId}
      RETURNING available_at AS "availableAt"
    `.execute(this.txHost.tx);

    return result.rows[0]?.availableAt ?? null;
  }

  /** Every resource still waiting to come back — the boot sweep's input. */
  async pending(): Promise<
    { mapId: number; cellId: number; availableAt: Date }[]
  > {
    const result = await sql<{
      mapId: number;
      cellId: number;
      availableAt: Date;
    }>`
      SELECT map_id AS "mapId", cell_id AS "cellId",
             available_at AS "availableAt"
        FROM gatherable_cell_states
       WHERE available_at > now()
       ORDER BY available_at
    `.execute(this.txHost.tx);

    return result.rows;
  }

  /**
   * The depleted cells of one map, for a client that has just walked onto
   * it. Without this a newcomer sees every stump as a standing tree.
   */
  async depletedOnMap(
    mapId: number
  ): Promise<{ cellId: number; reserved: boolean }[]> {
    const result = await sql<{ cellId: number; reserved: boolean }>`
      SELECT cell_id AS "cellId",
             COALESCE(reserved_until > now(), false) AS "reserved"
        FROM gatherable_cell_states
       WHERE map_id = ${mapId}
         AND (available_at > now() OR reserved_until > now())
    `.execute(this.txHost.tx);

    return result.rows;
  }
}
