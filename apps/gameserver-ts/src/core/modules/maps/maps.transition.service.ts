import { create } from "@bufbuild/protobuf";
import {
  GameActionSchema,
  GameActionType,
  GameMovementSchema,
  SpriteMovementEntry_Operation,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { toSpriteEntry } from "@modules/player-presence/player-presence.sprite-entry";
import { PlayersRepository } from "@modules/players/players.repository";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

// Moves a player to (targetMapId, targetCellId): pulls them from presence on
// the old map (with a REMOVE broadcast to everyone still there), persists
// the new position, and tells the client to re-enter. The client then
// issues GameCreate and the normal enter-game flow refills presence on the
// target map.

@Injectable()
export class MapTransitionService {
  private readonly logger = new Logger(MapTransitionService.name);

  constructor(
    private readonly players: PlayersRepository,
    private readonly presence: PlayerPresenceService,
    private readonly frames: GatewayFrameService
  ) {}

  async teleport(
    sessionId: string,
    characterId: string,
    targetMapId: number,
    targetCellId: number,
    targetDirection: number
  ): Promise<void> {
    const left = this.presence.leaveByCharacter(characterId);

    if (left) {
      const peers = this.presence.sessionsOnMap(left.mapId);

      if (peers.length > 0) {
        this.frames.broadcast(
          peers,
          create(DofusMessageSchema, {
            payload: {
              case: "gameMovement",
              value: create(GameMovementSchema, {
                entries: [
                  toSpriteEntry(left, SpriteMovementEntry_Operation.REMOVE),
                ],
              }),
            },
          })
        );
      }
    }

    await this.players.setMapPosition(
      characterId,
      targetMapId,
      targetCellId,
      targetDirection
    );

    this.logger.log(
      `teleport: character=${characterId} → map=${targetMapId} cell=${targetCellId}`
    );

    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            actionType: GameActionType.ACTION_MAP_CHANGE,
            spriteId: characterId,
            rawParams: String(targetMapId),
          }),
        },
      })
    );
  }
}
