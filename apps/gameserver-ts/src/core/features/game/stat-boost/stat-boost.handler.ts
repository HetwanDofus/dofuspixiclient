import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import {
  type AccountUseBoost,
  AccountUseBoostSchema,
} from "@dofus/proto/account_pb";
import { PlayersRepository } from "@modules/players/players.repository";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable } from "@nestjs/common";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";
import { match } from "ts-pattern";

@Injectable()
export class StatBoostHandler {
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

    const player = await this.players.findById(session.characterId);

    if (!player) {
      return;
    }

    const statColumn = match(msg.statId)
      .with(10, () => "strength" as const)
      .with(11, () => "vitality" as const)
      .with(12, () => "wisdom" as const)
      .with(13, () => "chance" as const)
      .with(14, () => "agility" as const)
      .with(15, () => "intelligence" as const)
      .otherwise(() => null);

    if (!statColumn) {
      return;
    }

    const cost = msg.quantity;

    if (player.statsPoints < cost) {
      return;
    }

    await this.players.boostStat(
      session.characterId,
      statColumn,
      msg.quantity,
      cost
    );

    await this.stats.sendStats(ctx.sessionId, session.characterId);
  }
}
