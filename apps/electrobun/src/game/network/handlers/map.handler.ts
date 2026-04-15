import { DofusPathfinding } from "@dofus/grid";

import type { AudioManager } from "@/game/audio/audio-manager";
import type { CellData } from "@/game/datacenter/cell";
import type { MapData } from "@/game/datacenter/map";
import { getMapTransitionDirection } from "@/game/input/map-coordinates";
import type { Connection } from "@/game/network/connection";
import type { MessageHandler } from "@/game/network/message-handler";
import { create } from "@bufbuild/protobuf";

import {
  encodeClient,
  GameActionAckSchema,
  GameGetExtraInfoSchema,
  type GameMapData,
  type MapCell,
  type SpriteMovementEntry,
} from "@/game/network/protocol";
import type { Battlefield } from "@/game/scene";
import { hudStore } from "@/game/stores";
import { createLogger } from "@/utils/logger";

import type { CharacterHandler, CharacterInfo } from "./character.handler";

const log = createLogger("MapHandler");

/**
 * Handles map + actor lifecycle over the new protobuf protocol.
 *
 *   gameMapData   → load map cells from local dofasset, build pathfinding
 *   gameMovement  → SpriteMovementEntry list with ADD / REMOVE / UPDATE
 *   gameAction    → ACTION_MOVEMENT (path animation for other sprites)
 *
 * Note: the server no longer streams compressed cell data or adjacent maps;
 * both are loaded directly from the client-side dofasset bundle.
 */
export class MapHandler {
  private currentMapId: number | null = null;
  private currentCellId: number | null = null;
  private pathfinding: DofusPathfinding | null = null;
  private isMoving = false;
  private mapLoadPromise: Promise<void> = Promise.resolve();

  // Messages that arrive before the Battlefield is ready are buffered and
  // replayed by `flushPending()` once the renderer attaches.
  private pendingMapData: GameMapData | null = null;
  private pendingMovements: SpriteMovementEntry[] = [];

  constructor(
    private readonly messageHandler: MessageHandler,
    private readonly connection: Connection,
    private readonly audioManager: AudioManager,
    private readonly characterHandler: CharacterHandler,
    private getBattlefield: () => Battlefield | null
  ) {
    this.register();
  }

  /**
   * Called by GameClient.setBattlefield() once the renderer is initialised.
   * Replays any gameMapData / gameMovement frames that arrived during init.
   */
  flushPending(): void {
    const pending = this.pendingMapData;
    this.pendingMapData = null;
    const queuedMovements = this.pendingMovements;
    this.pendingMovements = [];

    if (pending) {
      void this.handleMapData(pending).then(() => {
        if (queuedMovements.length > 0) {
          void this.handleMovement(queuedMovements);
        }
      });
    } else if (queuedMovements.length > 0) {
      void this.handleMovement(queuedMovements);
    }
  }

  getCurrentMapId(): number | null {
    return this.currentMapId;
  }

  getCurrentCellId(): number | null {
    return this.currentCellId;
  }

  getPathfinding(): DofusPathfinding | null {
    return this.pathfinding;
  }

  isCharacterMoving(): boolean {
    return this.isMoving;
  }

  setCharacterMoving(moving: boolean): void {
    this.isMoving = moving;
  }

  private register(): void {
    this.messageHandler.on("gameMapData", (payload) => {
      void this.handleMapData(payload);
    });

    this.messageHandler.on("gameMovement", (payload) => {
      void this.handleMovement(payload.entries);
    });

    this.messageHandler.on("gameAction", (payload) => {
      if (
        payload.actionType === 1 &&
        payload.actionData.case === "movement"
      ) {
        const spriteId = payload.spriteId;
        const path = payload.actionData.value.pathCells;
        void this.handleActorPath(spriteId, path, payload.sequenceId);
      }
    });
  }

  private async handleMapData(payload: GameMapData): Promise<void> {
    const mapId = payload.mapId;
    log.info(
      `gameMapData: map ${mapId} (${payload.cells.length} cells, ` +
        `${payload.width}x${payload.height}, bg=${payload.background})`
    );

    const battlefield = this.getBattlefield();
    if (!battlefield) {
      log.info("Battlefield not ready — buffering map data for replay");
      this.pendingMapData = payload;
      return;
    }

    const oldMapId = this.currentMapId;
    this.currentMapId = mapId;
    this.audioManager.playForMap(mapId);
    this.isMoving = false;

    try {
      const mapData = mapDataFromPayload(payload);
      this.buildPathfinding(mapData);
      battlefield.setPathfinding(this.pathfinding!);

      const direction = oldMapId
        ? (getMapTransitionDirection(oldMapId, mapId) ?? undefined)
        : undefined;

      // Reset the world-actor container BEFORE the new map's actors
      // arrive — server sends GM REMOVE for self only to other players
      // on the origin map, never to self. Without a reset our own
      // sprite from the old map lingers and the GM ADD for the new
      // map hits a duplicate id, which the renderer drops silently.
      battlefield.prepareWorldActors();

      this.mapLoadPromise = battlefield.loadMapFromData(mapData, direction);
      hudStore.setState({ minimapMapId: mapId });

      await this.mapLoadPromise;
      battlefield.revealMap();

      // Tell the server we're ready to receive sprites on this map.
      this.connection.send(
        encodeClient("gameGetExtraInfo", create(GameGetExtraInfoSchema, {}))
      );
    } catch (err) {
      log.error("Failed to load map:", err);
    }
  }

  private buildPathfinding(mapData: MapData): void {
    const walkableIds = mapData.cells.filter((c) => c.walkable).map((c) => c.id);
    this.pathfinding = new DofusPathfinding(
      mapData.width,
      mapData.height,
      walkableIds
    );
    log.debug(`Pathfinding built: ${walkableIds.length} walkable cells`);
  }

  private async handleMovement(entries: SpriteMovementEntry[]): Promise<void> {
    await this.mapLoadPromise;

    const battlefield = this.getBattlefield();
    if (!battlefield) {
      log.info(`Battlefield not ready — buffering ${entries.length} movements`);
      this.pendingMovements.push(...entries);
      return;
    }

    const current = this.characterHandler.getCurrentCharacter();

    for (const entry of entries) {
      const isSelf = entry.spriteId === current?.spriteId;

      if (entry.operation === 2 /* REMOVE */) {
        battlefield.removeWorldActor(numericId(entry.spriteId));
        continue;
      }

      // ADD or UPDATE — both place/refresh the actor.
      const look = encodeLook(entry);
      const numeric = numericId(entry.spriteId);

      await battlefield.addWorldActor({
        id: numeric,
        name: entry.name || `Actor ${entry.spriteId}`,
        cellId: entry.cellId,
        direction: entry.direction,
        look,
        isCurrentPlayer: isSelf,
        linkedChildren: [],
        mount: entry.mount,
      });

      if (isSelf) {
        this.currentCellId = entry.cellId;
        this.characterHandler.setMapPosition(
          this.currentMapId ?? 0,
          entry.cellId
        );
      }
    }
  }

  private async handleActorPath(
    spriteId: string,
    path: number[],
    sequenceId: number
  ): Promise<void> {
    const current = this.characterHandler.getCurrentCharacter();
    const numeric = numericId(spriteId);
    const isSelf = spriteId === current?.spriteId;

    if (isSelf && path.length > 0) {
      this.isMoving = true;
    }

    await this.getBattlefield()?.moveWorldActor(numeric, path);

    if (isSelf && path.length > 0) {
      this.currentCellId = path[path.length - 1];
      this.isMoving = false;
      this.characterHandler.setMapPosition(
        this.currentMapId ?? 0,
        this.currentCellId
      );
      // Tell the server the animation finished so it can commit the
      // authoritative position + emit GameActionsFinish + run any
      // map-change / cell-trigger evaluation. Without this ack, the
      // server keeps the move in-flight and rejects the next click.
      this.connection.send(
        encodeClient(
          "gameActionAck",
          create(GameActionAckSchema, {
            isAck: true,
            actionId: sequenceId,
          })
        )
      );
    }
  }
}

/**
 * Build a MapData (the renderer's input shape) from the inline GameMapData
 * proto frame. The server now decodes the StarLoco compressed cell payload
 * and ships per-cell typed fields, so the client no longer fetches a JSON
 * blob over HTTP.
 */
function mapDataFromPayload(payload: GameMapData): MapData {
  const cells: CellData[] = payload.cells.map(cellFromProto);
  const mapData: MapData = {
    id: payload.mapId,
    width: payload.width,
    height: payload.height,
    cells,
  };
  if (payload.background > 0) {
    mapData.backgroundNum = payload.background;
  }
  return mapData;
}

function cellFromProto(c: MapCell): CellData {
  return {
    id: c.id,
    active: c.active,
    ground: c.ground,
    layer1: c.layer1,
    layer2: c.layer2,
    groundLevel: c.groundLevel,
    groundSlope: c.groundSlope,
    walkable: c.walkable,
    movement: c.movement,
    lineOfSight: c.lineOfSight,
    layerGroundRot: c.layerGroundRot,
    layerGroundFlip: c.layerGroundFlip,
    layerObject1Rot: c.layerObject1Rot,
    layerObject1Flip: c.layerObject1Flip,
    layerObject2Rot: c.layerObject2Rot,
    layerObject2Flip: c.layerObject2Flip,
  };
}

function numericId(spriteId: string): number {
  const n = Number(spriteId);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the legacy look string (used by the sprite loader) from a proto
 * SpriteMovementEntry. Format: "gfxId|color1|color2|color3|accessories...".
 */
function encodeLook(entry: SpriteMovementEntry): string {
  const c = entry.colors;
  const parts: string[] = [
    String(entry.gfxId || 0),
    String(c?.color1 ?? -1),
    String(c?.color2 ?? -1),
    String(c?.color3 ?? -1),
  ];
  for (const acc of entry.accessories) {
    parts.push(`${acc.itemId}:${acc.skinId}:${acc.ordinal}`);
  }
  return parts.join("|");
}

export type { CharacterInfo };
