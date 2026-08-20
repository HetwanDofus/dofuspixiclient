import { create } from "@bufbuild/protobuf";
import { DofusPathfinding } from "@dofus/grid";

import type { AudioManager } from "@/game/audio/audio-manager";
import type { CellData } from "@/game/datacenter/cell";
import type { MapData } from "@/game/datacenter/map";
import type { Connection } from "@/game/network/connection";
import type { MessageHandler } from "@/game/network/message-handler";
import type { Battlefield } from "@/game/scene";
import { getMapTransitionDirection } from "@/game/input/map-coordinates";
import {
  encodeClient,
  GameActionAckSchema,
  GameCreateRequestSchema,
  GameGetExtraInfoSchema,
  type GameMapData,
  type MapCell,
  type SpriteMovementEntry,
} from "@/game/network/protocol";
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
  /**
   * Fires when OUR OWN sprite finishes a movement animation. Used by
   * the fight-mode reachable-range refresh: MP change frames land while
   * the animation is still running, so we have to defer the overlay
   * recompute until the sprite actually sits on its new cell.
   */
  private onSelfMoveComplete: (() => void) | null = null;
  /**
   * Fires the moment the server broadcasts OUR OWN move and the
   * animation starts. Used to clear the blue "selected path" flash
   * the client painted on click — matches GameActionsEx.as:163 where
   * the original runs `unSelect(true)` right before playing the
   * sprite move animation.
   */
  private onSelfMoveStart: (() => void) | null = null;

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

  setOnSelfMoveComplete(cb: (() => void) | null): void {
    this.onSelfMoveComplete = cb;
  }

  setOnSelfMoveStart(cb: (() => void) | null): void {
    this.onSelfMoveStart = cb;
  }

  private register(): void {
    this.messageHandler.on("gameMapData", (payload) => {
      void this.handleMapData(payload);
    });

    this.messageHandler.on("gameMovement", (payload) => {
      void this.handleMovement(payload.entries);
    });

    this.messageHandler.on("gameAction", (payload) => {
      if (payload.actionType === 1 && payload.actionData.case === "movement") {
        const spriteId = payload.spriteId;
        const path = payload.actionData.value.pathCells;
        void this.handleActorPath(spriteId, path, payload.sequenceId);
      } else if (payload.actionType === 2) {
        // ACTION_MAP_CHANGE — server moved us to a new map (edge transition,
        // waypoint, scripted cell). Re-enter the game so the server populates
        // presence + ships us the new map data + sprites.
        log.info(
          `map change → re-entering (target map in rawParams=${payload.rawParams})`
        );
        this.connection.send(
          encodeClient(
            "gameCreate",
            create(GameCreateRequestSchema, { type: 1 })
          )
        );
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
    void this.audioManager.playMusic(payload.musicId);
    void this.audioManager.playEnvironment(payload.ambianceId);
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
    const walkableIds = mapData.cells
      .filter((c) => c.walkable)
      .map((c) => c.id);
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
      const isMonsterGroup =
        entry.spriteType === 3 /* SPRITE_TYPE_MONSTER_GROUP */;
      // For monster groups the nameplate stays empty — the roster +
      // level + 5-star difficulty are rendered by the hover panel
      // (`MonsterGroupTooltip`, modelled on canonical
      // `dofus.graphics.battlefield.TextWithTitleOverHead`). Painting a
      // multi-line "Name (Lvl)\nName (Lvl)\n…" roster as the in-world
      // nameplate left a permanent wall of text above the sprite even
      // when the player wasn't hovering it; canonical only shows the
      // rich panel on `_rollOver` and clears it on `_rollOut`.
      const displayName = isMonsterGroup
        ? ""
        : entry.name || `Actor ${entry.spriteId}`;

      await battlefield.addWorldActor({
        id: numeric,
        name: displayName,
        cellId: entry.cellId,
        direction: entry.direction,
        look,
        isCurrentPlayer: isSelf,
        linkedChildren: [],
        mount: entry.mount,
        // Server ships team on every SpriteMovementEntry (0 during
        // roleplay, 0/1 during placement + combat). Passing it
        // through lets the PlayerRenderer paint the right ring color
        // as soon as fight-mode flips on.
        team: entry.team,
        ...(isMonsterGroup
          ? {
              monsterGroup: entry.monsters,
              monsterGroupBonus: entry.monsterGroupBonus,
            }
          : {}),
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
      // Server echoed our move back — drop the blue "selected path"
      // flash painted on click. Matches the original's unSelect(true)
      // call in GameActionsEx.as:163 just before the walk animation.
      try {
        this.onSelfMoveStart?.();
      } catch (err) {
        log.warn(`onSelfMoveStart threw: ${String(err)}`);
      }
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
      // Fire the move-complete hook AFTER currentCellId is updated so
      // the fight UI recomputes the reachable range from the new cell,
      // not the stale one. Any exception from the callback is isolated
      // from the network loop.
      try {
        this.onSelfMoveComplete?.();
      } catch (err) {
        log.warn(`onSelfMoveComplete threw: ${String(err)}`);
      }
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
  if (payload.subareaId > 0) {
    mapData.subareaId = payload.subareaId;
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
  if (Number.isFinite(n)) {
    return n;
  }
  // Non-numeric sprite IDs — monster groups use "${mapId}_${groupIndex}"
  // (enter-game.handler.ts). Hash to a stable NEGATIVE int so:
  //   - distinct groups don't collide on 0,
  //   - the legacy "< 0 = non-player" heuristic in picking.ts routes
  //     the click to the cell pick-through branch (walk then auto-
  //     trigger PvM), not the player context menu.
  let h = 0;
  for (let i = 0; i < spriteId.length; i++) {
    h = (h * 31 + spriteId.charCodeAt(i)) | 0;
  }
  // Ensure a negative, non-zero value.
  return -(Math.abs(h) || 1);
}

/**
 * Build the legacy look string (used by the sprite loader) from a proto
 * SpriteMovementEntry. Format: "gfxId|color1|color2|color3|acc1,acc2,acc3,acc4,acc5"
 * where each `accN` is `type_gfxId` (empty when the slot is empty). The
 * accessory array is sorted by `ordinal` so slot indices stay stable:
 *   0 = weapon, 1 = hat, 2 = cape, 3 = pet, 4 = shield.
 *
 * Monster groups carry their colors on the leader member, not on
 * `entry.colors`, so we read from `monsters[0]` when present.
 */
function encodeLook(entry: SpriteMovementEntry): string {
  const isMonsterGroup =
    entry.spriteType === 3 /* SPRITE_TYPE_MONSTER_GROUP */ &&
    entry.monsters.length > 0;
  const leader = isMonsterGroup ? entry.monsters[0] : null;
  const c = entry.colors;
  const parts: string[] = [
    String((leader?.gfxId || entry.gfxId) ?? 0),
    String(leader?.color1 ?? c?.color1 ?? -1),
    String(leader?.color2 ?? c?.color2 ?? -1),
    String(leader?.color3 ?? c?.color3 ?? -1),
  ];
  if (entry.accessories.length > 0) {
    const maxOrdinal = Math.max(
      ...entry.accessories.map((a) => a.ordinal ?? 0),
      -1
    );
    const slots: string[] = Array(maxOrdinal + 1).fill("");
    for (const acc of entry.accessories) {
      const ord = acc.ordinal ?? 0;
      // `item_id` carries the category (hat=16 etc.), `skin_id` the GFX.
      slots[ord] = `${acc.itemId}_${acc.skinId}`;
    }
    parts.push(slots.join(","));
  }
  return parts.join("|");
}

export type { CharacterInfo };
