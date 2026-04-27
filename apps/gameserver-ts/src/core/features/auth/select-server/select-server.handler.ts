import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  type AccountSelectServerRequest,
  AccountSelectServerRequestSchema,
  AccountSelectServerSchema,
  SelectServerError,
} from "@dofus/proto/account_pb";
import { ServerState } from "@dofus/proto/common_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { TICKET_TTL_MS } from "@features/auth/select-server/select-server.constants";
import { SelectServerRepository } from "@features/auth/select-server/select-server.repository";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class SelectServerHandler {
  private readonly logger = new Logger(SelectServerHandler.name);

  constructor(
    private readonly repo: SelectServerRepository,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(AccountSelectServerRequestSchema)
  async handle(
    ctx: HandlerContext,
    msg: AccountSelectServerRequest
  ): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);

    if (!session?.accountId) {
      this.logger.warn(
        `select-server: unauthenticated session=${ctx.sessionId}`
      );
      return this.reject(ctx, SelectServerError.RESTRICTED);
    }

    const server = await this.repo.findServer(msg.serverId);

    if (!server) {
      return this.reject(ctx, SelectServerError.NOT_FOUND);
    }

    if (server.state !== ServerState.ONLINE) {
      return this.reject(ctx, SelectServerError.DOWN);
    }

    if (server.onlinePlayers >= server.maxPlayers) {
      return this.reject(ctx, SelectServerError.FULL);
    }

    const ticket = crypto.randomUUID();

    await this.repo.issueTicket({
      ticket,
      accountId: session.accountId,
      gameServerId: server.id,
      expiresAt: new Date(Date.now() + TICKET_TTL_MS),
    });

    this.logger.log(`ticket: account=${session.accountId} server=${server.id}`);

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountSelectServer",
          value: create(AccountSelectServerSchema, {
            success: true,
            useIpEncoding: false,
            ip: server.address,
            port: server.port,
            ticket,
          }),
        },
      })
    );
  }

  private reject(ctx: HandlerContext, errorCode: SelectServerError): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountSelectServer",
          value: create(AccountSelectServerSchema, {
            success: false,
            errorCode,
          }),
        },
      })
    );
  }
}
