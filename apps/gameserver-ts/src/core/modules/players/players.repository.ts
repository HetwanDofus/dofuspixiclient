import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class PlayersRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  getPosition(characterId: string) {
    return this.txHost.tx
      .selectFrom("players")
      .select(["id", "mapId", "cellId", "direction"])
      .where("id", "=", characterId)
      .where("deletedAt", "is", null)
      .executeTakeFirst();
  }

  loadPresence(characterId: string) {
    return this.txHost.tx
      .selectFrom("players")
      .leftJoin("playerColors", "playerColors.playerId", "players.id")
      .where("players.id", "=", characterId)
      .where("players.deletedAt", "is", null)
      .select([
        "players.id",
        "players.name",
        "players.level",
        "players.sex",
        "players.gfx",
        "players.mapId",
        "players.cellId",
        "players.direction",
        "playerColors.color1",
        "playerColors.color2",
        "playerColors.color3",
      ])
      .executeTakeFirst();
  }

  async updatePosition(
    characterId: string,
    cellId: number,
    direction: number
  ): Promise<void> {
    await this.txHost.tx
      .updateTable("players")
      .set({ cellId, direction })
      .where("id", "=", characterId)
      .execute();
  }

  async setMapPosition(
    characterId: string,
    mapId: number,
    cellId: number,
    direction: number
  ): Promise<void> {
    await this.txHost.tx
      .updateTable("players")
      .set({ mapId, cellId, direction })
      .where("id", "=", characterId)
      .execute();
  }

  async addXpAndKamas(
    playerId: string,
    xp: number,
    kamas: number
  ): Promise<void> {
    await this.txHost.tx
      .updateTable("players")
      .set((eb) => ({
        experience: eb("experience", "+", String(xp)),
        kamas: eb("kamas", "+", String(kamas)),
      }))
      .where("id", "=", playerId)
      .execute();
  }

  findById(playerId: string) {
    return this.txHost.tx
      .selectFrom("players")
      .selectAll()
      .where("id", "=", playerId)
      .where("deletedAt", "is", null)
      .executeTakeFirst();
  }

  findStats(playerId: string) {
    return this.txHost.tx
      .selectFrom("playerStats")
      .selectAll()
      .where("playerId", "=", playerId)
      .executeTakeFirst();
  }

  async levelUp(playerId: string): Promise<void> {
    await this.txHost.tx
      .updateTable("players")
      .set((eb) => ({
        level: eb("level", "+", 1),
        statsPoints: eb("statsPoints", "+", 5),
        spellPoints: eb("spellPoints", "+", 1),
      }))
      .where("id", "=", playerId)
      .execute();
  }

  async boostStat(
    playerId: string,
    stat:
      | "strength"
      | "vitality"
      | "wisdom"
      | "chance"
      | "agility"
      | "intelligence",
    amount: number,
    cost: number
  ): Promise<void> {
    await this.txHost.tx
      .updateTable("playerStats")
      .set((eb) => ({ [stat]: eb(stat, "+", amount) }))
      .where("playerId", "=", playerId)
      .execute();

    await this.txHost.tx
      .updateTable("players")
      .set((eb) => ({ statsPoints: eb("statsPoints", "-", cost) }))
      .where("id", "=", playerId)
      .execute();
  }

  /**
   * Debits `cost` spell points ("capital sorts"), returning the number of
   * rows it touched — 0 when the player could no longer afford it.
   *
   * This is the *gate* on a spell upgrade, not a bookkeeping step after
   * one: the `spellPoints >= cost` predicate and the subtraction happen
   * in the same statement, so two upgrade frames racing over the same
   * balance cannot both pass. Callers must treat 0 as a refusal and
   * grant nothing.
   */
  async spendSpellPoints(playerId: string, cost: number): Promise<number> {
    const res = await this.txHost.tx
      .updateTable("players")
      .set((eb) => ({ spellPoints: eb("spellPoints", "-", cost) }))
      .where("id", "=", playerId)
      .where("spellPoints", ">=", cost)
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }

  /**
   * Gives `cost` spell points back. Only for unwinding a debit whose
   * matching level grant turned out to be a no-op — see the upgrade
   * handler; there is no gameplay path that refunds points.
   */
  async refundSpellPoints(playerId: string, cost: number): Promise<void> {
    await this.txHost.tx
      .updateTable("players")
      .set((eb) => ({ spellPoints: eb("spellPoints", "+", cost) }))
      .where("id", "=", playerId)
      .execute();
  }
}
