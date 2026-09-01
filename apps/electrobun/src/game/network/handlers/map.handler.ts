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
import { numericId } from "@/game/network/sprite-id";
import { closeNpcDialog, hudStore } from "@/game/stores";
import { beginHarvest, endHarvest } from "@/game/stores/jobs-store";
import { createLogger } from "@/utils/logger";

import type { CharacterHandler, CharacterInfo } from "./character.handler";

const log = createLogger("MapHandler");

/**
 * How long a move request may go unanswered before the client stops
 * considering it in flight. Only a request the server refuses outright
 * ever reaches this — a validated one is echoed in the same round trip.
 */
const SELF_MOVE_TIMEOUT_MS = 2_000;

/** `GameActionType.ACTION_HARVEST` — `GA;501;<cellId>,<durationMs>`. */
const ACTION_HARVEST = 501;

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
  /**
   * Set when the player cut the current walk short — the ack that
   * closes the move must then be a cancel (`GKE`) carrying the cell we
   * actually stopped on, not a plain `GKK` the server would read as
   * "arrived at the destination you validated".
   */
  private selfMoveInterrupted = false;
  /**
   * Set when the interruption was asked for before the server echoed
   * the move back: there is no animation to cut yet, so the path is cut
   * to its first step the moment it arrives instead.
   */
  private truncateNextSelfPath = false;
  /**
   * When our own move request went out, `null` once it has been acked.
   *
   * A move owns the character until its ack: the server keeps exactly
   * one pending move per session and matches the ack by id, so a second
   * request sent before the first is acked orphans it — the ack that
   * follows names a move the server has already replaced, and the
   * position it was going to commit is lost. This is what makes a
   * second click wait for the first move instead of racing it, over the
   * whole request → echo → animation → ack round trip and not just the
   * animation.
   */
  private selfMoveSentAt: number | null = null;

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

  /**
   * Remember that a move request went out; called by GameClient.move.
   *
   * Also clears any interruption left over from a request the server
   * never answered — otherwise the flags would cut this move short
   * instead of the one they were raised for.
   */
  markSelfMoveSent(): void {
    this.selfMoveSentAt = Date.now();
    this.selfMoveInterrupted = false;
    this.truncateNextSelfPath = false;
  }

  /**
   * Whether one of our own moves is still owed an ack — from the moment
   * the request is sent to the moment the walk is acknowledged.
   *
   * Expires on its own: a request the server refuses outright (a path it
   * will not validate) is never echoed and would otherwise hold every
   * later click hostage.
   */
  isSelfMoveInFlight(): boolean {
    if (this.selfMoveSentAt === null) {
      return false;
    }

    if (Date.now() - this.selfMoveSentAt > SELF_MOVE_TIMEOUT_MS) {
      this.selfMoveSentAt = null;
      return false;
    }

    return true;
  }

  /**
   * Cut our own move short at the cell the sprite is entering.
   *
   * Returns false when there was nothing to interrupt, and the caller
   * should just do what it wanted straight away. Returns true when the
   * interruption is under way: the move then completes one cell later
   * through the ordinary `handleActorPath` tail, which sends the cancel
   * and fires `onSelfMoveComplete` — where whatever the player asked
   * for instead is replayed, from the cell they really stopped on.
   *
   * The request can land before the server has echoed the move back, in
   * which case there is no animation to cut yet and the path is cut to
   * its first step when it arrives.
   */
  interruptSelfMove(): boolean {
    if (!this.isSelfMoveInFlight()) {
      return false;
    }

    this.selfMoveInterrupted = true;

    if (!this.isMoving) {
      this.truncateNextSelfPath = true;
      log.info("move interrupted before the server echoed it back");
      return true;
    }

    const self = this.characterHandler.getCurrentCharacter();
    const stopCell = self
      ? this.getBattlefield()?.interruptWorldActor(numericId(self.spriteId))
      : null;

    log.info(
      stopCell === null || stopCell === undefined
        ? "move interrupted, but the sprite is gone — closing the move anyway"
        : `move interrupted → stopping at cell ${stopCell}`
    );

    return true;
  }

  private register(): void {
    this.messageHandler.on("gameMapData", (payload) => {
      void this.handleMapData(payload);
    });

    this.messageHandler.on("gameMovement", (payload) => {
      void this.handleMovement(payload.entries);
    });

    // `GDF` — interactive elements changing state. Nothing else on the wire
    // carries it: the map payload is immutable and identical for everyone,
    // so a felled tree is only ever a frame like this one.
    this.messageHandler.on("gameFrameObject2", (payload) => {
      const battlefield = this.getBattlefield();

      for (const entry of payload.entries) {
        battlefield?.setCellInteractive(entry.cellId, entry.interactive);
      }
    });

    this.messageHandler.on("gameAction", (payload) => {
      if (payload.actionType === 1 && payload.actionData.case === "movement") {
        const spriteId = payload.spriteId;
        const path = payload.actionData.value.pathCells;
        void this.handleActorPath(spriteId, path, payload.sequenceId);
      } else if (
        payload.actionType === ACTION_HARVEST &&
        payload.actionData.case === "harvest"
      ) {
        this.handleHarvestAction(
          payload.spriteId,
          payload.actionData.value.cellId,
          payload.actionData.value.durationMs
        );
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

  /**
   * `GA;501` — somebody on this map started harvesting.
   *
   * Only the local character's action drives the progress bar; the rest is
   * for the animation, which the renderer does not have yet. The duration is
   * the server's own and is not recomputed here — a client that shortened it
   * would only be lying to its own player.
   */
  private handleHarvestAction(
    spriteId: string,
    cellId: number,
    durationMs: number
  ): void {
    const self = this.characterHandler.getCurrentCharacter();

    if (!self || String(self.id) !== spriteId) {
      return;
    }

    beginHarvest(
      cellId,
      durationMs,
      this.getBattlefield()?.getSpriteAnchor(Number(self.id)) ?? null
    );
    globalThis.setTimeout(endHarvest, durationMs);
  }

  private async handleMapData(payload: GameMapData): Promise<void> {
    const mapId = payload.mapId;

    // A conversation does not survive leaving the map it happened on. The
    // server drops its half in `enter-game` and echoes DV, but the window has
    // to go even if that frame is lost — otherwise it sits there un-closable.
    closeNpcDialog();

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

      // A map change ends any move the old map still owed an ack for —
      // the server teleported us, so nothing is in flight any more.
      this.selfMoveSentAt = null;
      this.selfMoveInterrupted = false;
      this.truncateNextSelfPath = false;

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
      hudStore.setState({
        minimapMapId: mapId,
        currentSubareaId: payload.subareaId > 0 ? payload.subareaId : null,
      });

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
      const isNpc = entry.spriteType === 4 /* SPRITE_TYPE_NPC */;
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
        // Percentages on the wire (100 = life size), a multiplier here.
        // Only NPCs carry a meaningful value today — every other producer
        // hardcodes 100 — so a 0 or a missing field must read as 1, not as
        // an invisible sprite.
        scale: entry.scaleX > 0 ? entry.scaleX / 100 : 1,
        ...(isMonsterGroup
          ? {
              monsterGroup: entry.monsters,
              monsterGroupBonus: entry.monsterGroupBonus,
            }
          : {}),
        // The NPC *template* id: what keys the `npc` lang bundle the action
        // bubble is built from. Distinct from the sprite id, which is a
        // per-placement number.
        ...(isNpc ? { npcTemplateId: entry.npcId } : {}),
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
    rawPath: number[],
    sequenceId: number
  ): Promise<void> {
    const current = this.characterHandler.getCurrentCharacter();
    const numeric = numericId(spriteId);
    const isSelf = spriteId === current?.spriteId;

    // The player asked for something else before this echo came back:
    // walk the first step and stop there, which is the same place the
    // sprite would have stopped had the interruption arrived mid-walk.
    let path = rawPath;

    if (isSelf && this.truncateNextSelfPath) {
      this.truncateNextSelfPath = false;
      path = rawPath.slice(0, 2);
    }

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

    const battlefield = this.getBattlefield();

    await battlefield?.moveWorldActor(numeric, path);

    if (isSelf && path.length > 0) {
      // Where the sprite actually stands, which is not always the last
      // cell of the path the server sent: an interrupted walk stops one
      // cell in. Falling back to the path end keeps the old behaviour
      // if the actor is gone from the renderer.
      const interrupted = this.selfMoveInterrupted;
      this.selfMoveInterrupted = false;
      this.selfMoveSentAt = null;
      const landedCell =
        battlefield?.getWorldActorRenderer()?.getPlayerCell(numeric) ??
        path[path.length - 1];

      this.currentCellId = landedCell;
      this.isMoving = false;
      this.characterHandler.setMapPosition(
        this.currentMapId ?? 0,
        this.currentCellId
      );
      // Tell the server the animation finished so it can commit the
      // authoritative position + emit GameActionsFinish + run any
      // map-change / cell-trigger evaluation. Without this ack, the
      // server keeps the move in-flight and rejects the next click.
      //
      // `GKE` — the canonical cancel — is what an interrupted walk
      // sends instead: same action id, plus the cell we stopped on, so
      // the server commits where the sprite really is rather than
      // where the path was heading.
      this.connection.send(
        encodeClient(
          "gameActionAck",
          create(GameActionAckSchema, {
            isAck: !interrupted,
            actionId: sequenceId,
            ...(interrupted ? { cancelParams: String(landedCell) } : {}),
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
    layerObject2Interactive: c.layerObject2Interactive,
  };
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
