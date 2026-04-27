import type { Session } from "@shared/gateway-adapter/session-registry";
import { create } from "@bufbuild/protobuf";
import {
  GameMovementSchema,
  SpriteMovementEntry_Operation,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { toSpriteEntry } from "@modules/player-presence/player-presence.sprite-entry";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

type SessionClosedPayload = {
  session: Session;
  reason: string;
};

@Injectable()
export class SessionLeaveSaga {
  private readonly logger = new Logger(SessionLeaveSaga.name);

  constructor(
    private readonly presence: PlayerPresenceService,
    private readonly frames: GatewayFrameService
  ) {}

  @OnEvent("session.closed")
  onSessionClosed({ session, reason }: SessionClosedPayload) {
    const player = this.presence.leaveBySession(session.sessionId);

    if (!player) {
      return;
    }

    const peers = this.presence.sessionsOnMap(player.mapId);

    if (peers.length > 0) {
      this.frames.broadcast(
        peers,
        create(DofusMessageSchema, {
          payload: {
            case: "gameMovement",
            value: create(GameMovementSchema, {
              entries: [
                toSpriteEntry(player, SpriteMovementEntry_Operation.REMOVE),
              ],
            }),
          },
        })
      );
    }

    this.logger.log(
      `leave: character=${player.characterId} map=${player.mapId} reason=${reason}`
    );
  }
}
