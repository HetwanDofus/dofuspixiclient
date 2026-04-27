import type { GameEnv } from "@shared/config/env.schema";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  AccountCharactersListSchema,
  AccountGetCharactersListSchema,
  CharacterListEntrySchema,
} from "@dofus/proto/account_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import {
  CHARACTER_LEVEL_MAX,
  MAX_CHARACTERS_PER_ACCOUNT,
} from "@features/game/character-list/character-list.constants";
import { CharacterListRepository } from "@features/game/character-list/character-list.repository";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

const DEFAULT_COLOR = -1;

@Injectable()
export class CharacterListHandler {
  private readonly logger = new Logger(CharacterListHandler.name);
  private readonly gameServerId: number;

  constructor(
    config: ConfigService<GameEnv, true>,
    private readonly repo: CharacterListRepository,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService
  ) {
    this.gameServerId = config.get("GAME_SERVER_ID", { infer: true });
  }

  @MessageHandler(AccountGetCharactersListSchema)
  async handle(ctx: HandlerContext): Promise<void> {
    // The client may send this before the ticket is fully redeemed.
    // Wait for the session.authenticated event rather than rejecting immediately.
    const session = await this.sessions.waitForAuth(ctx.sessionId);

    if (!session?.accountId) {
      this.logger.warn(
        `character-list: unauthenticated session=${ctx.sessionId}`
      );
      return this.respond(ctx, []);
    }

    const rows = await this.repo.listForAccount(
      session.accountId,
      this.gameServerId
    );

    const characters = rows.map((r) =>
      create(CharacterListEntrySchema, {
        id: r.id,
        name: r.name,
        level: r.level,
        gfxId: r.gfx,
        color1: r.color1 ?? DEFAULT_COLOR,
        color2: r.color2 ?? DEFAULT_COLOR,
        color3: r.color3 ?? DEFAULT_COLOR,
        serverId: r.serverId,
        levelMax: CHARACTER_LEVEL_MAX,
      })
    );

    this.respond(ctx, characters);
  }

  private respond(
    ctx: HandlerContext,
    characters: ReturnType<typeof create<typeof CharacterListEntrySchema>>[]
  ): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountCharactersList",
          value: create(AccountCharactersListSchema, {
            success: true,
            characterCount: MAX_CHARACTERS_PER_ACCOUNT,
            characters,
          }),
        },
      })
    );
  }
}
