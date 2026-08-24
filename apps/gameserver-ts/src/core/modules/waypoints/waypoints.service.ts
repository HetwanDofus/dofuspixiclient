import { create } from "@bufbuild/protobuf";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import {
  WaypointEntrySchema,
  WaypointsCreateSchema,
  WaypointsLeaveSchema,
  WaypointsUseErrorSchema,
} from "@dofus/proto/world_pb";
import { MapsRepository } from "@modules/maps/maps.repository";
import { MapTransitionService } from "@modules/maps/maps.transition.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { WaypointsRepository } from "@modules/waypoints/waypoints.repository";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

@Injectable()
export class WaypointsService {
  private readonly logger = new Logger(WaypointsService.name);

  constructor(
    private readonly repo: WaypointsRepository,
    private readonly maps: MapsRepository,
    private readonly players: PlayersRepository,
    private readonly presence: PlayerPresenceService,
    private readonly transition: MapTransitionService,
    private readonly frames: GatewayFrameService
  ) {}

  async openZaapMenu(sessionId: string, characterId: string): Promise<void> {
    const player = this.presence.getByCharacter(characterId);
    if (!player) {
      return;
    }

    // Auto-discover current zaap
    const currentWaypoint = await this.repo.findByMapId(player.mapId);
    if (currentWaypoint) {
      await this.repo.discover(characterId, currentWaypoint.id);
    }

    // Get all known zaaps (kind=0)
    const known = await this.repo.knownByPlayer(characterId);
    const zaaps = known.filter((w) => w.kind === 0);

    // Get current map coordinates for cost calculation
    const currentMap = await this.maps.findById(player.mapId);
    if (!currentMap) {
      return;
    }

    // Build waypoint entries with cost
    const entries = zaaps.map((w) => {
      const cost =
        w.mapId === player.mapId
          ? 0
          : 10 *
            (Math.abs(w.x - currentMap.x) + Math.abs(w.y - currentMap.y) - 1);

      return create(WaypointEntrySchema, {
        mapId: w.mapId,
        level: cost,
      });
    });

    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "waypointsCreate",
          value: create(WaypointsCreateSchema, {
            maxWaypointLevel: 0,
            waypoints: entries,
          }),
        },
      })
    );
  }

  async teleportViaZaap(
    sessionId: string,
    characterId: string,
    waypointId: number
  ): Promise<void> {
    const player = this.presence.getByCharacter(characterId);
    if (!player) {
      return;
    }

    const waypoint = await this.repo.findById(String(waypointId));
    if (!waypoint) {
      this.sendUseError(sessionId);
      return;
    }

    // Verify player knows this zaap
    const known = await this.repo.isKnown(characterId, waypoint.id);
    if (!known) {
      this.sendUseError(sessionId);
      return;
    }

    // Calculate cost
    const currentMap = await this.maps.findById(player.mapId);
    if (!currentMap) {
      this.sendUseError(sessionId);
      return;
    }

    const targetMap = await this.maps.findById(waypoint.mapId);
    if (!targetMap) {
      this.sendUseError(sessionId);
      return;
    }

    const cost =
      waypoint.mapId === player.mapId
        ? 0
        : 10 *
          (Math.abs(targetMap.x - currentMap.x) +
            Math.abs(targetMap.y - currentMap.y) -
            1);

    // Deduct kamas. The affordability check lives inside the debit itself
    // (`kamas >= cost` in the same UPDATE) rather than a read beforehand,
    // so two zaap uses racing the same balance cannot both pass — the
    // read-then-write this replaced could.
    const paid = await this.players.spendKamas(characterId, cost);
    if (paid === 0) {
      this.sendUseError(sessionId);
      return;
    }

    // Teleport
    await this.transition.teleport(
      sessionId,
      characterId,
      waypoint.mapId,
      waypoint.cellId,
      3
    );

    // Close zaap menu
    this.sendLeave(sessionId);
    this.logger.log(
      `Zaap used: ${characterId} → map ${waypoint.mapId} (cost: ${cost})`
    );
  }

  leaveZaapMenu(sessionId: string): void {
    this.sendLeave(sessionId);
  }

  private sendLeave(sessionId: string): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "waypointsLeave",
          value: create(WaypointsLeaveSchema, {}),
        },
      })
    );
  }

  private sendUseError(sessionId: string): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "waypointsUseError",
          value: create(WaypointsUseErrorSchema, {}),
        },
      })
    );
  }
}
