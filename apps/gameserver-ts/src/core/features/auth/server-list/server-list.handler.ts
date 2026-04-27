import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  AccountGetServersListSchema,
  AccountServersListSchema,
  ServerEntrySchema,
} from "@dofus/proto/account_pb";
import { ServerState } from "@dofus/proto/common_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { ServerListRepository } from "@features/auth/server-list/server-list.repository";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class ServerListHandler {
  private readonly logger = new Logger(ServerListHandler.name);

  constructor(
    private readonly repo: ServerListRepository,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(AccountGetServersListSchema)
  async handle(ctx: HandlerContext): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);

    if (!session?.accountId) {
      this.logger.warn(`server-list: unauthenticated session=${ctx.sessionId}`);
      return this.respond(ctx, []);
    }

    const rows = await this.repo.listForAccount(session.accountId);

    const servers = rows.map((r) =>
      create(ServerEntrySchema, {
        serverId: r.serverId,
        characterCount: r.characterCount ?? 0,
        state: r.state,
        completion: completionPct(r.onlinePlayers, r.maxPlayers),
        isSelectable: r.state === ServerState.ONLINE,
      })
    );

    this.respond(ctx, servers);
  }

  private respond(
    ctx: HandlerContext,
    servers: ReturnType<typeof create<typeof ServerEntrySchema>>[]
  ): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountServersList",
          value: create(AccountServersListSchema, {
            success: true,
            servers,
          }),
        },
      })
    );
  }
}

function completionPct(online: number, max: number): number {
  if (max <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((online / max) * 100));
}
