import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  type GameActionAck,
  GameActionAckSchema,
  GameActionsFinishSchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { FightStartService } from "@features/game/fight-start/fight-start.service";
import { MapCacheService } from "@modules/maps/maps.cache.service";
import { detectExitDirection, oppositeEdgeCell } from "@modules/maps/maps.edge";
import { MapsRepository } from "@modules/maps/maps.repository";
import { MapTransitionService } from "@modules/maps/maps.transition.service";
import { MapMonsterService } from "@modules/monsters/map-monster.service";
import { PendingMovesService } from "@modules/player-presence/player-presence.pending-moves.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { ScriptedCellsService } from "@modules/scripted-cells/scripted-cells.service";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";

@Injectable()
export class MoveAckHandler {
  private readonly logger = new Logger(MoveAckHandler.name);

  constructor(
    private readonly players: PlayersRepository,
    private readonly pending: PendingMovesService,
    private readonly presence: PlayerPresenceService,
    private readonly maps: MapsRepository,
    private readonly mapCache: MapCacheService,
    private readonly scripts: ScriptedCellsService,
    private readonly transition: MapTransitionService,
    private readonly frames: GatewayFrameService,
    private readonly mapMonsters: MapMonsterService,
    private readonly fightStart: FightStartService
  ) {}

  @MessageHandler(GameActionAckSchema)
  async handle(ctx: HandlerContext, msg: GameActionAck): Promise<void> {
    const move = this.pending.take(ctx.sessionId);

    if (!move) {
      return;
    }

    if (move.actionId !== msg.actionId) {
      this.logger.warn(
        `ack: id mismatch session=${ctx.sessionId} expected=${move.actionId} got=${msg.actionId}`
      );
      return;
    }

    this.presence.updatePosition(
      move.characterId,
      move.endCell,
      move.endDirection
    );

    await this.players.updatePosition(
      move.characterId,
      move.endCell,
      move.endDirection
    );

    this.frames.broadcast(
      this.presence.sessionsOnMap(move.mapId),
      create(DofusMessageSchema, {
        payload: {
          case: "gameActionsFinish",
          value: create(GameActionsFinishSchema, {
            actionResultId: move.actionId,
            spriteId: move.characterId,
          }),
        },
      })
    );

    const scripted = await this.scripts.onPlayerArrived(
      ctx.sessionId,
      move.characterId,
      move.mapId,
      move.endCell
    );

    if (scripted) {
      return;
    }

    const pvmTriggered = await this.maybeTriggerPvM(
      ctx.sessionId,
      move.characterId,
      move.mapId,
      move.endCell
    );

    if (pvmTriggered) {
      return;
    }

    await this.maybeCrossEdge(
      ctx.sessionId,
      move.characterId,
      move.mapId,
      move.endCell
    );
  }

  private async maybeTriggerPvM(
    sessionId: string,
    characterId: string,
    mapId: number,
    cellId: number
  ): Promise<boolean> {
    const group = this.mapMonsters.findGroupAtCell(mapId, cellId);

    if (!group) {
      return false;
    }

    const player = this.presence.getByCharacter(characterId);

    if (!player) {
      this.logger.warn(
        `PvM trigger: player not in presence cache characterId=${characterId}`
      );
      return false;
    }

    const fightPlaces = await this.maps.findFightPlaces(mapId);
    const places0 = fightPlaces?.places0 ?? "";
    const places1 = fightPlaces?.places1 ?? "";

    const mapData = await this.mapCache.load(mapId);

    if (!mapData) {
      this.logger.warn(`PvM trigger: map not loadable mapId=${mapId}`);
      return false;
    }

    const walkable = this.mapMonsters.walkableCells(mapId);

    const fight = await this.fightStart.startPvM(
      sessionId,
      player,
      mapData.width,
      mapData.height,
      places0,
      places1,
      {
        groupId: group.id,
        mapId: group.mapId,
        cellId: group.cellId,
        members: group.members,
      },
      walkable
    );

    if (fight !== null) {
      this.mapMonsters.consumeGroup(group.id);
    }

    return fight !== null;
  }

  private async maybeCrossEdge(
    sessionId: string,
    characterId: string,
    mapId: number,
    cellId: number
  ): Promise<void> {
    const sourceMap = await this.mapCache.load(mapId);

    if (!sourceMap) {
      return;
    }

    const detected = detectExitDirection(
      cellId,
      sourceMap.width,
      sourceMap.height
    );

    if (detected === undefined) {
      return;
    }

    const resolved = await this.resolveNeighbor(mapId, detected);

    if (!resolved) {
      return;
    }

    const targetMap = await this.mapCache.load(resolved.neighborMapId);

    if (!targetMap) {
      this.logger.warn(
        `edge-transition: neighbor map ${resolved.neighborMapId} not loadable`
      );
      return;
    }

    const landingCell = oppositeEdgeCell(
      cellId,
      resolved.direction,
      sourceMap.width,
      targetMap.width,
      targetMap.height
    );

    if (landingCell === undefined) {
      return;
    }

    await this.transition.teleport(
      sessionId,
      characterId,
      resolved.neighborMapId,
      landingCell,
      resolved.direction
    );
  }

  private async resolveNeighbor(
    mapId: number,
    detected: number
  ): Promise<{ neighborMapId: number; direction: number } | undefined> {
    for (const direction of DIRECTION_LOOKUP[detected] ?? [detected]) {
      const link = await this.maps.findNeighborInDirection(mapId, direction);

      if (link) {
        return { neighborMapId: link.neighborMapId, direction };
      }
    }

    return undefined;
  }
}

const DIRECTION_LOOKUP: Readonly<Record<number, readonly number[]>> = {
  0: [0],
  1: [1, 2, 0],
  2: [2],
  3: [3, 2, 4],
  4: [4],
  5: [5, 6, 4],
  6: [6],
  7: [7, 6, 0],
};
