import { match } from "ts-pattern";
import type { Battlefield } from "@/ank/battlefield";
import { FighterAnimation } from "@/ank/battlefield/fighter-animation";
import { createLogger } from "@/utils/logger";
import {
  loadMapDataFromServer,
  type ServerMapDataPayload,
} from "@/ank/battlefield/datacenter/map";
import { getMapTransitionDirection, preloadMapCoordinates } from "@/ank/battlefield/map-coordinates";
import { DofusPathfinding } from "@/ank/battlefield/dofus-pathfinding";
import { AudioManager } from "@/audio/audio-manager";
import { Connection, type ConnectionEvent } from "@/network/connection";
import {
  createMessageHandler,
  type MessageHandler,
} from "@/network/message-handler";
import {
  type ActorAddPayload,
  type ActorMovePayload,
  type ActorRemovePayload,
  type ActorUpdatePayload,
  type AdjacentMapsPayload,
  type AuthSuccessPayload,
  type CharacterInfoPayload,
  type CharacterStatsPayload,
  type InventoryListPayload,
  type ItemAddPayload,
  type ItemMovePayload,
  type ItemQuantityPayload,
  type ItemRemovePayload,
  type InventoryWeightPayload,
  type MapActorsPayload,
  ClientMessageType,
  encodeClientMessage,
  ServerMessageType,
} from "@/network/protocol";
import type { CharacterStats } from "@/types/stats";
import { InventoryStore } from "./inventory-store";

export interface CharacterInfo {
  id: number;
  name: string;
  class: number;
  sex: number;
  gfx: number;
  level: number;
  mapId: number;
  cellId: number;
}

export interface GameClientConfig {
  serverUrl?: string;
}

const log = createLogger("GameClient");

export class GameClient {
  private connection: Connection;
  private messageHandler: MessageHandler;
  private battlefield: Battlefield | null = null;

  private accountCharacters: CharacterInfo[] = [];
  private currentCharacter: CharacterInfo | null = null;
  private currentMapId: number | null = null;
  private currentCellId: number | null = null;
  private pathfinding: DofusPathfinding | null = null;
  private isMoving = false;
  private isSitting = false;
  private mapLoadPromise: Promise<void> = Promise.resolve();
  private currentStats: CharacterStats | null = null;
  private audioManager: AudioManager;
  private inventoryStore = new InventoryStore();

  /** Incremented on each MAP_DATA to invalidate stale MAP_ACTORS handlers. */
  private mapGeneration = 0;
  /** True while a map transition is in progress (between MAP_DATA and revealMap). */
  private mapTransitioning = false;

  private onCharacterList?: (characters: CharacterInfo[]) => void;
  private onLoginFailed?: (reason: string) => void;
  private onConnected?: () => void;
  private onDisconnected?: () => void;

  constructor(config?: GameClientConfig) {
    this.connection = new Connection({
      url: config?.serverUrl ?? "ws://localhost:8080/game",
    });
    this.messageHandler = createMessageHandler();
    this.audioManager = AudioManager.getInstance();
    this.audioManager.init();
    preloadMapCoordinates();

    this.connection.addEventListener((event: ConnectionEvent) => {
      match(event)
        .with({ type: "connected" }, () => {
          log.info("Connected to server");
          this.onConnected?.();
        })
        .with({ type: "disconnected" }, (e) => {
          log.info("Disconnected:", e.reason);
          this.onDisconnected?.();
        })
        .with({ type: "message" }, (e) => {
          this.messageHandler.handle(e.message);
        })
        .otherwise(() => {});
    });

    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.messageHandler.on(ServerMessageType.AUTH_SUCCESS, (payload: AuthSuccessPayload) => {
      this.accountCharacters = payload.characters ?? [];
      log.info("Login success, characters:", this.accountCharacters.length);
      this.onCharacterList?.(this.accountCharacters);
    });

    this.messageHandler.on(ServerMessageType.AUTH_FAILURE, (payload) => {
      log.error("Login failed:", payload.reason);
      this.onLoginFailed?.(payload.reason);
    });

    this.messageHandler.on(ServerMessageType.CHARACTER_INFO, (payload: CharacterInfoPayload) => {
      this.currentCharacter = {
        id: payload.id,
        name: payload.name,
        class: payload.class,
        sex: payload.sex,
        gfx: payload.gfx,
        level: payload.level,
        mapId: payload.mapId,
        cellId: payload.cellId,
      };
      this.currentMapId = payload.mapId;
      this.currentCellId = payload.cellId;
      log.info("Character selected:", payload.name, "on map", payload.mapId, "cell", payload.cellId);
      this.battlefield?.getStatsPanel()?.setCharacterName(payload.name);
      this.battlefield?.getInventoryPanel()?.setCharacterGfx(payload.gfx);
      this.battlefield?.getInventoryPanel()?.bindStore(this.inventoryStore);
      this.battlefield?.setDebugPlayerId(payload.id);
    });

    this.messageHandler.on(ServerMessageType.CHARACTER_STATS, (payload: CharacterStatsPayload) => {
      this.currentStats = payload as CharacterStats;
      this.battlefield?.getStatsPanel()?.updateStats(this.currentStats);
    });

    // ── Inventory handlers ──
    this.messageHandler.on(ServerMessageType.INVENTORY_LIST, (payload: InventoryListPayload) => {
      this.inventoryStore.handleInventoryList(payload);
    });
    this.messageHandler.on(ServerMessageType.ITEM_ADD, (payload: ItemAddPayload) => {
      this.inventoryStore.handleItemAdd(payload);
    });
    this.messageHandler.on(ServerMessageType.ITEM_REMOVE, (payload: ItemRemovePayload) => {
      this.inventoryStore.handleItemRemove(payload);
    });
    this.messageHandler.on(ServerMessageType.ITEM_QUANTITY, (payload: ItemQuantityPayload) => {
      this.inventoryStore.handleItemQuantity(payload);
    });
    this.messageHandler.on(ServerMessageType.ITEM_MOVE, (payload: ItemMovePayload) => {
      this.inventoryStore.handleItemMove(payload);
    });
    this.messageHandler.on(ServerMessageType.ITEM_WEIGHT, (payload: InventoryWeightPayload) => {
      this.inventoryStore.handleWeightUpdate(payload);
    });

    this.messageHandler.on(ServerMessageType.MAP_DATA, (payload) => {
      const serverPayload = payload as unknown as ServerMapDataPayload;
      log.info(`Received MAP_DATA for map ${serverPayload.mapId}`);

      this.mapGeneration++;
      this.mapTransitioning = true;

      try {
        const mapData = loadMapDataFromServer(serverPayload);
        const oldMapId = this.currentMapId;
        this.currentMapId = serverPayload.mapId;

        this.audioManager.playForMap(serverPayload.mapId);

        this.isMoving = false;

        const walkableIds = mapData.cells
          .filter((c) => c.walkable)
          .map((c) => c.id);
        this.pathfinding = new DofusPathfinding(
          mapData.width,
          mapData.height,
          walkableIds
        );
        log.debug(`Pathfinding built: ${walkableIds.length} walkable cells`);

        // Pass pathfinding to battlefield for pet movement
        this.battlefield?.setPathfinding(this.pathfinding);

        const triggerCellIds = mapData.triggerCellIds ?? [];
        if (triggerCellIds.length > 0) {
          log.debug(`Trigger cells (${triggerCellIds.length}): ${triggerCellIds.join(", ")}`);
        }

        if (this.battlefield) {
          const direction = oldMapId
            ? getMapTransitionDirection(oldMapId, serverPayload.mapId) ?? undefined
            : undefined;
          if (direction) {
            log.debug(`Directional transition: dx=${direction.dx} dy=${direction.dy}`);
          }

          this.mapLoadPromise = this.battlefield.loadMapFromData(mapData, direction);
          this.battlefield.updateMinimapPosition(serverPayload.mapId);
        }
      } catch (err) {
        log.error("Failed to decompress map data:", err);
      }
    });

    this.messageHandler.on(
      ServerMessageType.MAP_ACTORS,
      async (payload: MapActorsPayload) => {
        const actors: ActorAddPayload[] = payload.actors ?? [];
        const generation = this.mapGeneration;
        log.info("MAP_ACTORS:", actors.length, "actors", "gen:", generation);

        if (!this.battlefield) return;

        await this.mapLoadPromise;

        if (generation !== this.mapGeneration) {
          log.info("MAP_ACTORS gen", generation, "stale (current:", this.mapGeneration, "), skipping");
          return;
        }

        this.battlefield.prepareWorldActors();

        const spritePromises: Promise<void>[] = [];

        for (const actor of actors) {
          const isCurrentPlayer = actor.id === this.currentCharacter?.id;
          const promise = this.battlefield.addWorldActor({
            id: actor.id,
            name: actor.name ?? `Player ${actor.id}`,
            cellId: actor.cellId,
            direction: actor.direction,
            look: actor.look ?? "",
            isCurrentPlayer,
            linkedChildren: actor.linkedChildren,
          });
          spritePromises.push(promise);

          if (isCurrentPlayer) {
            this.currentCellId = actor.cellId;
          }
        }

        await Promise.allSettled(spritePromises);

        if (generation !== this.mapGeneration) {
          log.info("MAP_ACTORS gen", generation, "stale after sprites, skipping");
          return;
        }

        this.mapTransitioning = false;
        this.battlefield.revealMap();
      }
    );

    this.messageHandler.on(ServerMessageType.ACTOR_ADD, (payload: ActorAddPayload) => {
      log.info("ACTOR_ADD:", payload.name ?? payload.id);

      if (this.mapTransitioning) {
        log.debug("ACTOR_ADD skipped during map transition");
        return;
      }

      this.battlefield?.addWorldActor({
        id: payload.id,
        name: payload.name ?? `Player ${payload.id}`,
        cellId: payload.cellId,
        direction: payload.direction,
        look: payload.look ?? "",
        isCurrentPlayer: payload.id === this.currentCharacter?.id,
        linkedChildren: payload.linkedChildren,
      });
    });

    this.messageHandler.on(ServerMessageType.ACTOR_REMOVE, (payload: ActorRemovePayload) => {
      log.debug("ACTOR_REMOVE:", payload.id);
      this.battlefield?.removeWorldActor(payload.id);
    });

    this.messageHandler.on(ServerMessageType.ACTOR_UPDATE, (payload: ActorUpdatePayload) => {
      log.debug("ACTOR_UPDATE:", payload.id, "look:", payload.look);
      if (payload.look != null) {
        this.battlefield?.updateActorLook(payload.id, payload.look);
      }
    });

    this.messageHandler.on(
      ServerMessageType.ACTOR_MOVE,
      async (payload: ActorMovePayload) => {
        const { id, path } = payload;

        if (id === this.currentCharacter?.id && path.length > 0) {
          this.isMoving = true;
          this.isSitting = false;
        }
        await this.battlefield?.moveWorldActor(id, path);
        if (id === this.currentCharacter?.id && path.length > 0) {
          this.currentCellId = path[path.length - 1];
          this.isMoving = false;
          this.connection.send(
            encodeClientMessage(ClientMessageType.CHARACTER_MOVE_END, {}),
          );
        }
      }
    );

    this.messageHandler.on(ServerMessageType.MAP_ADJACENT, (payload: AdjacentMapsPayload) => {
      log.debug(`MAP_ADJACENT: ${payload.maps.length} adjacent maps`);
      this.battlefield?.loadAdjacentMaps(payload.maps);
    });
  }

  setBattlefield(battlefield: Battlefield): void {
    this.battlefield = battlefield;
    this.battlefield.setOnCellClick((cellId) => this.handleCellClick(cellId));
    this.battlefield.setOnMinimapTeleport((mapId) => this.handleMinimapTeleport(mapId));
    this.battlefield.setOnBoostStat((statId) => this.boostStat(statId));
    this.battlefield.setOnSitToggle(() => this.toggleSit());

    if (this.currentStats) {
      this.battlefield.getStatsPanel()?.updateStats(this.currentStats);
    }
  }

  private handleMinimapTeleport(mapId: number): void {
    if (this.currentMapId === mapId) return;
    log.info(`Minimap teleport to map ${mapId}`);
    this.changeMap(mapId);
  }

  private handleCellClick(targetCellId: number): void {
    if (this.currentCellId === null || !this.pathfinding || this.isMoving)
      return;

    const path = this.pathfinding.findPath(this.currentCellId, targetCellId);
    if (!path || path.length < 2) return;

    log.debug(`Moving: ${this.currentCellId} -> ${targetCellId} (${path.length - 1} steps)`);
    this.move(path);
  }

  private toggleSit(): void {
    const charId = this.currentCharacter?.id;
    if (charId == null || this.isMoving) return;

    this.isSitting = !this.isSitting;
    const animation = this.isSitting ? FighterAnimation.SIT : FighterAnimation.IDLE;
    this.battlefield?.setWorldActorAnimation(charId, animation);
  }

  connect(): void {
    this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  login(username: string, password: string): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.AUTH_LOGIN, {
        username,
        password,
        version: "1.29",
      })
    );
  }

  selectCharacter(characterId: number, classId?: number): void {
    if (classId != null) {
      this.battlefield?.getStatsPanel()?.setClassId(classId);
    }
    this.connection.send(
      encodeClientMessage(ClientMessageType.CHARACTER_SELECT, { characterId })
    );
  }

  move(path: number[]): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.CHARACTER_MOVE, { path })
    );
  }

  changeMap(mapId: number): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.MAP_CHANGE, { mapId })
    );
  }

  boostStat(statId: number): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.CHARACTER_BOOST_STAT, { statId })
    );
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  getCharacters(): CharacterInfo[] {
    return this.accountCharacters;
  }

  getCurrentCharacter(): CharacterInfo | null {
    return this.currentCharacter;
  }

  getCurrentMapId(): number | null {
    return this.currentMapId;
  }

  getCurrentStats(): CharacterStats | null {
    return this.currentStats;
  }

  getAudioManager(): AudioManager {
    return this.audioManager;
  }

  getInventory(): InventoryStore {
    return this.inventoryStore;
  }

  moveItem(uid: number, position: number, quantity?: number): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.ITEM_MOVE, { uid, position, quantity })
    );
  }

  useItem(uid: number): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.ITEM_USE, { uid })
    );
  }

  dropItem(uid: number, quantity: number): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.ITEM_DROP, { uid, quantity })
    );
  }

  destroyItem(uid: number, quantity: number): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.ITEM_DESTROY, { uid, quantity })
    );
  }

  debugGiveItem(templateId: number, quantity = 1): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.DEBUG_GIVE_ITEM, { templateId, quantity })
    );
  }

  debugGiveCapital(amount: number): void {
    this.connection.send(
      encodeClientMessage(ClientMessageType.DEBUG_GIVE_CAPITAL, { amount })
    );
  }

  setOnCharacterList(fn: (characters: CharacterInfo[]) => void): void {
    this.onCharacterList = fn;
  }

  setOnLoginFailed(fn: (reason: string) => void): void {
    this.onLoginFailed = fn;
  }

  setOnConnected(fn: () => void): void {
    this.onConnected = fn;
  }

  setOnDisconnected(fn: () => void): void {
    this.onDisconnected = fn;
  }

  destroy(): void {
    this.connection.destroy();
    this.messageHandler.clear();
    this.audioManager.destroy();
    this.battlefield = null;
  }
}
