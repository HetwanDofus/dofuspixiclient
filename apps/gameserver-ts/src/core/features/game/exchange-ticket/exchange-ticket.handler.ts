import type { GameEnv } from "@shared/config/env.schema";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  type AccountSendTicket,
  AccountSendTicketSchema,
  AccountTicketResponseSchema,
} from "@dofus/proto/account_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { ExchangeTicketRepository } from "@features/game/exchange-ticket/exchange-ticket.repository";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class ExchangeTicketHandler {
  private readonly logger = new Logger(ExchangeTicketHandler.name);
  private readonly gameServerId: number;

  constructor(
    config: ConfigService<GameEnv, true>,
    private readonly repo: ExchangeTicketRepository,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService
  ) {
    this.gameServerId = config.get("GAME_SERVER_ID", { infer: true });
  }

  @MessageHandler(AccountSendTicketSchema)
  async handle(ctx: HandlerContext, msg: AccountSendTicket): Promise<void> {
    const row = await this.repo.redeem(msg.ticket, this.gameServerId);

    if (!row) {
      this.logger.warn(
        `ticket: rejected session=${ctx.sessionId} server=${this.gameServerId}`
      );
      return this.respond(ctx, false);
    }

    this.sessions.attachAccount(ctx.sessionId, row.accountId);

    this.logger.log(
      `ticket: redeemed account=${row.accountId} session=${ctx.sessionId}`
    );

    this.respond(ctx, true);
  }

  private respond(ctx: HandlerContext, success: boolean): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountTicketResponse",
          value: create(AccountTicketResponseSchema, {
            success,
            keyId: success ? 0 : -1,
          }),
        },
      })
    );
  }
}
