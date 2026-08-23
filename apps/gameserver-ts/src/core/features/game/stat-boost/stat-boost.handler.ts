import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import {
  type AccountUseBoost,
  AccountUseBoostSchema,
} from "@dofus/proto/account_pb";
import { PlayersRepository } from "@modules/players/players.repository";
import { type BoostableStat, boostCost } from "@modules/stats/boost-cost";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";
import { match } from "ts-pattern";

/**
 * `AccountUseBoost.stat_id` uses the 1.29 wire numbering, which is the
 * same 10-15 block the fight engine's `Characteristic` map uses — and
 * *not* the panel's own 0-5 `STAT_IDS`. The client converts on its way
 * out; this is the only place the server reads those numbers.
 */
function wireStatToColumn(statId: number): BoostableStat | null {
  return match(statId)
    .with(10, () => "strength" as const)
    .with(11, () => "vitality" as const)
    .with(12, () => "wisdom" as const)
    .with(13, () => "chance" as const)
    .with(14, () => "agility" as const)
    .with(15, () => "intelligence" as const)
    .otherwise(() => null);
}

/**
 * AB — spend capital to raise one characteristic.
 *
 * The cost is *not* what the client sent. Dofus 1.29 prices a point by
 * breed and by how high the characteristic already is (see
 * `boostCost`), so a Sacrieur buying Force at 200 pays 5 capital for it,
 * not 1. Taking `quantity` as the price — as this handler used to —
 * let any client buy the whole table at one point apiece.
 *
 * Debit before credit, and treat the debit's row count as the gate:
 * frames dispatch fire-and-forget, so two AB frames interleave at every
 * await and a read-then-write check passes twice on the same balance.
 * `spendStatPoints` folds the affordability test into the UPDATE, so
 * exactly one of them wins. A credit that then no-ops (the player row
 * vanished mid-flight) is unwound with an explicit refund.
 *
 * Only one point at a time is bought, whatever `quantity` says: the
 * price changes as the characteristic crosses a threshold, so a bulk
 * order would need re-pricing per point and the retail panel never
 * sends one.
 */
@Injectable()
export class StatBoostHandler {
  private readonly logger = new Logger(StatBoostHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly players: PlayersRepository,
    private readonly stats: StatsService
  ) {}

  @MessageHandler(AccountUseBoostSchema)
  async handle(ctx: HandlerContext, msg: AccountUseBoost): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }
    const characterId = session.characterId;

    const statColumn = wireStatToColumn(msg.statId);
    if (!statColumn) {
      return;
    }

    const [player, baseStats] = await Promise.all([
      this.players.findById(characterId),
      this.players.findStats(characterId),
    ]);
    if (!player || !baseStats) {
      return;
    }

    const cost = boostCost(player.class, statColumn, baseStats[statColumn]);

    // The debit, not this read, is what reserves the capital.
    const debited = await this.players.spendStatPoints(characterId, cost);
    if (debited === 0) {
      return;
    }

    const granted = await this.players.boostStat(characterId, statColumn, 1);
    if (granted === 0) {
      await this.players.refundStatPoints(characterId, cost);
      return;
    }

    // The panel has no local model of the boost: it redraws entirely
    // from the As frame, which also carries the new capital.
    await this.stats.sendStats(ctx.sessionId, characterId);

    this.logger.log(
      `stat-boost player=${characterId} stat=${statColumn} ` +
        `${baseStats[statColumn]}->${baseStats[statColumn] + 1} cost=${cost}`
    );
  }
}
