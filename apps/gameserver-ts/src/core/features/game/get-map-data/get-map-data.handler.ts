import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  type GameGetMapData,
  GameGetMapDataSchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { HarvestService } from "@modules/harvest/harvest.service";
import { buildMapData } from "@modules/maps/maps.build-data";
import { MapsRepository } from "@modules/maps/maps.repository";
import { PlayersRepository } from "@modules/players/players.repository";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class GetMapDataHandler {
  private readonly logger = new Logger(GetMapDataHandler.name);

  constructor(
    private readonly players: PlayersRepository,
    private readonly maps: MapsRepository,
    private readonly harvest: HarvestService,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(GameGetMapDataSchema)
  async handle(ctx: HandlerContext, msg: GameGetMapData): Promise<void> {
    const mapId = await this.resolveMapId(ctx.sessionId, msg.mapId);

    if (mapId === null) {
      return;
    }

    const map = await this.maps.findById(mapId);

    if (!map) {
      this.logger.warn(`get-map-data: map not found id=${mapId}`);

      return;
    }

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: { case: "gameMapData", value: buildMapData(map) },
      })
    );

    // Cells carry no state — the map payload is immutable and identical for
    // everyone. Without this a player walking onto a map someone has been
    // working sees every stump as a standing tree, and can click one.
    await this.harvest.framesForMap(ctx.sessionId, mapId);
  }

  private async resolveMapId(
    sessionId: string,
    requested: number
  ): Promise<number | null> {
    if (requested !== 0) {
      return requested;
    }

    const session = this.sessions.get(sessionId);

    if (!session?.characterId) {
      this.logger.warn(`get-map-data: no character on session=${sessionId}`);
      return null;
    }

    const player = await this.players.getPosition(session.characterId);

    return player?.mapId ?? null;
  }
}
