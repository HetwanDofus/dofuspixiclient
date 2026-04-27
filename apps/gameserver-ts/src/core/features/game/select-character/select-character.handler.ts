import type { GameEnv } from "@shared/config/env.schema";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  AccountCharacterSelectedSchema,
  type AccountSelectCharacter,
  AccountSelectCharacterSchema,
  AccountStatsSchema,
} from "@dofus/proto/account_pb";
import { StatEntrySchema } from "@dofus/proto/common_pb";
import {
  type DofusMessage,
  DofusMessageSchema,
} from "@dofus/proto/server_messages_pb";
import {
  DEFAULT_AP,
  DEFAULT_DISCERNMENT,
  DEFAULT_MAX_SUMMONS,
  DEFAULT_MP,
  ENERGY_MAX,
} from "@features/game/select-character/select-character.constants";
import { SelectCharacterRepository } from "@features/game/select-character/select-character.repository";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

const DEFAULT_COLOR = -1;

type CharacterRow = NonNullable<
  Awaited<ReturnType<SelectCharacterRepository["load"]>>
>;

@Injectable()
export class SelectCharacterHandler {
  private readonly logger = new Logger(SelectCharacterHandler.name);
  private readonly gameServerId: number;

  constructor(
    config: ConfigService<GameEnv, true>,
    private readonly repo: SelectCharacterRepository,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService
  ) {
    this.gameServerId = config.get("GAME_SERVER_ID", { infer: true });
  }

  @MessageHandler(AccountSelectCharacterSchema)
  async handle(
    ctx: HandlerContext,
    msg: AccountSelectCharacter
  ): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);

    if (!session?.accountId) {
      this.logger.warn(
        `select-character: unauthenticated session=${ctx.sessionId}`
      );
      return this.reject(ctx);
    }

    const player = await this.repo.load(
      String(msg.characterId),
      session.accountId,
      this.gameServerId
    );

    if (!player) {
      this.logger.warn(
        `select-character: not found id=${msg.characterId} account=${session.accountId}`
      );
      return this.reject(ctx);
    }

    this.sessions.attachCharacter(ctx.sessionId, player.id);

    this.logger.log(
      `select-character: ${player.name} (${player.id}) session=${ctx.sessionId}`
    );

    this.frames.broadcast([ctx.sessionId], buildSelected(player));
    this.frames.broadcast([ctx.sessionId], buildStats(player));
  }

  private reject(ctx: HandlerContext): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountCharacterSelected",
          value: create(AccountCharacterSelectedSchema, { success: false }),
        },
      })
    );
  }
}

function buildSelected(p: CharacterRow): DofusMessage {
  return create(DofusMessageSchema, {
    payload: {
      case: "accountCharacterSelected",
      value: create(AccountCharacterSelectedSchema, {
        success: true,
        characterId: Number(p.id),
        characterName: p.name,
        level: p.level,
        sex: p.sex,
        gfxId: p.gfx,
        color1: p.color1 ?? DEFAULT_COLOR,
        color2: p.color2 ?? DEFAULT_COLOR,
        color3: p.color3 ?? DEFAULT_COLOR,
      }),
    },
  });
}

function buildStats(p: CharacterRow): DofusMessage {
  const stat = (base: number) => create(StatEntrySchema, { base });

  return create(DofusMessageSchema, {
    payload: {
      case: "accountStats",
      value: create(AccountStatsSchema, {
        xp: BigInt(p.experience),
        xpLow: 0n,
        xpHigh: 0n,
        kama: BigInt(p.kamas),
        bonusPoints: p.statsPoints,
        bonusPointsSpell: p.spellPoints,
        lp: p.life,
        lpMax: p.life,
        energy: p.energy,
        energyMax: ENERGY_MAX,
        initiative: 0,
        discernment: DEFAULT_DISCERNMENT,
        ap: stat(DEFAULT_AP),
        mp: stat(DEFAULT_MP),
        strength: stat(p.strength),
        vitality: stat(p.vitality),
        wisdom: stat(p.wisdom),
        intelligence: stat(p.intelligence),
        chance: stat(p.chance),
        agility: stat(p.agility),
        maxSummons: stat(DEFAULT_MAX_SUMMONS),
        showedLevel: p.level,
      }),
    },
  });
}
