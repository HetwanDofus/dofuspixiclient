import { MapTransitionService } from "@modules/maps/maps.transition.service";
import {
  DEFAULT_LANDING_DIRECTION,
  ScriptedCellVerb,
} from "@modules/scripted-cells/scripted-cells.constants";
import { ScriptedCellsRepository } from "@modules/scripted-cells/scripted-cells.repository";
import { WaypointsService } from "@modules/waypoints/waypoints.service";
import { Injectable, Logger } from "@nestjs/common";

// Dispatches scripted-cell verbs triggered by a player's arrival on a cell.
// `onPlayerArrived` returns true when a verb fired, short-circuiting the
// caller's fallback logic (edge-based auto-transition in move-ack).

@Injectable()
export class ScriptedCellsService {
  private readonly logger = new Logger(ScriptedCellsService.name);

  constructor(
    private readonly repo: ScriptedCellsRepository,
    private readonly transition: MapTransitionService,
    private readonly waypoints: WaypointsService
  ) {}

  async onPlayerArrived(
    sessionId: string,
    characterId: string,
    mapId: number,
    cellId: number
  ): Promise<boolean> {
    const row = await this.repo.find(mapId, cellId);

    if (!row) {
      return false;
    }

    switch (row.verb) {
      case ScriptedCellVerb.Teleport:
        return this.dispatchTeleport(sessionId, characterId, row.actionsArgs);
      case ScriptedCellVerb.Zaap:
      case ScriptedCellVerb.Zaapi:
        return this.dispatchZaap(sessionId, characterId);
      default:
        this.logger.warn(
          `scripted-cells: verb "${row.verb}" not implemented (map=${mapId} cell=${cellId})`
        );
        return false;
    }
  }

  private async dispatchTeleport(
    sessionId: string,
    characterId: string,
    args: string
  ): Promise<boolean> {
    const target = parseMapCell(args);

    if (!target) {
      this.logger.warn(
        `scripted-cells: TP args "${args}" malformed, expected "mapId,cellId"`
      );
      return false;
    }

    await this.transition.teleport(
      sessionId,
      characterId,
      target.mapId,
      target.cellId,
      DEFAULT_LANDING_DIRECTION
    );

    return true;
  }

  private async dispatchZaap(
    sessionId: string,
    characterId: string
  ): Promise<boolean> {
    await this.waypoints.openZaapMenu(sessionId, characterId);
    return true;
  }
}

function parseMapCell(s: string): { mapId: number; cellId: number } | null {
  const parts = s.trim().split(",");

  if (parts.length !== 2) {
    return null;
  }

  const mapId = Number.parseInt((parts[0] ?? "").trim(), 10);
  const cellId = Number.parseInt((parts[1] ?? "").trim(), 10);

  if (!Number.isFinite(mapId) || !Number.isFinite(cellId)) {
    return null;
  }

  return { mapId, cellId };
}
