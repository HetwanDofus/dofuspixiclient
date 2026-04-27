import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class FightHistoryRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  async insertHistory(data: {
    type: number;
    mapId: number;
    startedAt: Date;
    endedAt: Date;
    winnerTeam: number;
    durationMs: number;
  }) {
    return this.txHost.tx
      .insertInto("fightHistory")
      .values(data)
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  async insertParticipant(data: {
    fightId: string;
    playerId: string | null;
    monsterId: number | null;
    team: number;
    xpGained: string;
    kamasGained: string;
    dead: boolean;
    leftFight: boolean;
  }) {
    await this.txHost.tx.insertInto("fightParticipants").values(data).execute();
  }
}
