import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  type GameActionRequest,
  GameActionRequestSchema,
  GameActionSchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { FightStartService } from "@features/game/fight-start/fight-start.service";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { MapCacheService } from "@modules/maps/maps.cache.service";
import { MapsRepository } from "@modules/maps/maps.repository";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";
import { match } from "ts-pattern";

interface PendingChallenge {
  challengerCharacterId: string;
  challengerSessionId: string;
  targetCharacterId: string;
  targetSessionId: string;
  mapId: number;
}

@Injectable()
export class FightChallengeHandler {
  private readonly logger = new Logger(FightChallengeHandler.name);
  private pending = new Map<string, PendingChallenge>();

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly presence: PlayerPresenceService,
    private readonly frames: GatewayFrameService,
    private readonly fightStart: FightStartService,
    private readonly fightRegistry: FightRegistryService,
    private readonly maps: MapsRepository,
    private readonly mapCache: MapCacheService
  ) {}

  @MessageHandler(GameActionRequestSchema)
  async handle(ctx: HandlerContext, msg: GameActionRequest): Promise<void> {
    await match(msg.actionType)
      .with(900, () => this.handleRequest(ctx, msg))
      .with(901, () => this.handleAccept(ctx, msg))
      .with(902, () => this.handleCancel(ctx, msg))
      .otherwise(() => {});
  }

  private handleRequest(ctx: HandlerContext, msg: GameActionRequest): void {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }

    const challenger = this.presence.getByCharacter(session.characterId);
    if (!challenger) {
      return;
    }

    if (this.fightRegistry.isInFight(ctx.sessionId)) {
      return;
    }

    const targetCharId = msg.params;
    if (!targetCharId) {
      return;
    }

    const target = this.presence.getByCharacter(targetCharId);
    if (!target || target.mapId !== challenger.mapId) {
      return;
    }
    if (this.fightRegistry.isInFight(target.sessionId)) {
      return;
    }

    const key = `${targetCharId}:${session.characterId}`;
    this.pending.set(key, {
      challengerCharacterId: session.characterId,
      challengerSessionId: ctx.sessionId,
      targetCharacterId: targetCharId,
      targetSessionId: target.sessionId,
      mapId: challenger.mapId,
    });

    const mapSessions = this.presence.sessionsOnMap(challenger.mapId);
    this.frames.broadcast(
      mapSessions,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 900,
            actionType: 900,
            spriteId: session.characterId,
            rawParams: targetCharId,
          }),
        },
      })
    );

    this.logger.log(`Challenge: ${session.characterId} → ${targetCharId}`);

    setTimeout(() => {
      if (this.pending.has(key)) {
        this.pending.delete(key);
        this.handleCancelBroadcast(
          challenger.mapId,
          session.characterId,
          targetCharId
        );
      }
    }, 30_000);
  }

  private async handleAccept(
    ctx: HandlerContext,
    msg: GameActionRequest
  ): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }

    const challengerCharId = msg.params;
    if (!challengerCharId) {
      return;
    }

    const key = `${session.characterId}:${challengerCharId}`;
    const challenge = this.pending.get(key);
    if (!challenge) {
      this.logger.warn(`No pending challenge ${key}`);
      return;
    }
    this.pending.delete(key);

    const challenger = this.presence.getByCharacter(
      challenge.challengerCharacterId
    );
    const defender = this.presence.getByCharacter(session.characterId);
    if (!challenger || !defender) {
      return;
    }

    const mapSessions = this.presence.sessionsOnMap(challenge.mapId);
    this.frames.broadcast(
      mapSessions,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 901,
            actionType: 901,
            spriteId: challenge.challengerCharacterId,
            rawParams: session.characterId,
          }),
        },
      })
    );

    const mapData = await this.mapCache.load(challenge.mapId);
    if (!mapData) {
      return;
    }

    const fightPlaces = await this.maps.findFightPlaces(challenge.mapId);
    const places0 = fightPlaces?.places0 ?? "";
    const places1 = fightPlaces?.places1 ?? "";

    const fight = await this.fightStart.startChallenge(
      challenge.challengerSessionId,
      ctx.sessionId,
      challenger,
      defender,
      mapData.width,
      mapData.height,
      places0,
      places1
    );

    if (fight) {
      this.logger.log(
        `Challenge fight started: id=${fight.id} ${challenge.challengerCharacterId} vs ${session.characterId}`
      );
    }
  }

  private handleCancel(ctx: HandlerContext, msg: GameActionRequest): void {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }

    const otherCharId = msg.params;
    if (!otherCharId) {
      return;
    }

    const key1 = `${otherCharId}:${session.characterId}`;
    const key2 = `${session.characterId}:${otherCharId}`;
    const challenge = this.pending.get(key1) ?? this.pending.get(key2);
    if (!challenge) {
      return;
    }

    this.pending.delete(key1);
    this.pending.delete(key2);

    this.handleCancelBroadcast(
      challenge.mapId,
      session.characterId,
      otherCharId
    );
    this.logger.log(
      `Challenge cancelled: ${session.characterId} ↔ ${otherCharId}`
    );
  }

  private handleCancelBroadcast(
    mapId: number,
    cancelerId: string,
    otherId: string
  ): void {
    const mapSessions = this.presence.sessionsOnMap(mapId);
    this.frames.broadcast(
      mapSessions,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 902,
            actionType: 902,
            spriteId: cancelerId,
            rawParams: otherId,
          }),
        },
      })
    );
  }
}
