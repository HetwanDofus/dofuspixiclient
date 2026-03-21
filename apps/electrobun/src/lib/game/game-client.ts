import { match } from "ts-pattern";
import type { Battlefield } from "@/ank/battlefield";
import type { GameWorld } from "@/ecs/world";
import {
  loadMapDataFromServer,
  type ServerMapDataPayload,
} from "@/ank/battlefield/datacenter/map";
import { DofusPathfinding } from "@/ank/battlefield/dofus-pathfinding";
import { Connection, type ConnectionEvent } from "@/network/connection";
import {
  createMessageHandler,
  type MessageHandler,
} from "@/network/message-handler";
import {
  type ActorAddPayload,
  type ActorMovePayload,
  type ActorRemovePayload,
  type CharacterStatsPayload,
  ClientMessageType,
  encodeMessage,
  ServerMessageType,
} from "@/network/protocol";
import type { CharacterStats } from "@/types/stats";

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
  private mapLoadPromise: Promise<void> = Promise.resolve();
  private gameWorld: GameWorld | null = null;
  private currentStats: CharacterStats | null = null;

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

    this.connection.addEventListener((event: ConnectionEvent) => {
      match(event)
        .with({ type: "connected" }, () => {
          console.log("[GameClient] Connected to server");
          this.onConnected?.();
        })
        .with({ type: "disconnected" }, (e) => {
          console.log("[GameClient] Disconnected:", e.reason);
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
    // AUTH_SUCCESS — receive character list
    this.messageHandler.on(ServerMessageType.AUTH_SUCCESS, (payload: any) => {
      this.accountCharacters = payload.characters ?? [];
      console.log("[GameClient] Login success, characters:", this.accountCharacters.length);
      this.onCharacterList?.(this.accountCharacters);
    });

    // AUTH_FAILURE
    this.messageHandler.on(ServerMessageType.AUTH_FAILURE, (payload: any) => {
      console.error("[GameClient] Login failed:", payload.reason);
      this.onLoginFailed?.(payload.reason);
    });

    // CHARACTER_INFO — character selected, receive full info
    this.messageHandler.on(ServerMessageType.CHARACTER_INFO, (payload: any) => {
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
      console.log("[GameClient] Character selected:", payload.name, "on map", payload.mapId, "cell", payload.cellId);
      this.battlefield?.getStatsPanel()?.setCharacterName(payload.name);
      this.battlefield?.getInventoryPanel()?.setCharacterGfx(payload.gfx);
      this.battlefield?.setDebugPlayerId(payload.id);
    });

    // CHARACTER_STATS — receive stats from server
    this.messageHandler.on(ServerMessageType.CHARACTER_STATS, (payload: any) => {
      const stats = payload as CharacterStatsPayload;
      this.currentStats = stats as CharacterStats;
      this.battlefield?.getStatsPanel()?.updateStats(this.currentStats);
    });

    // MAP_DATA — receive compressed map data from server
    this.messageHandler.on(ServerMessageType.MAP_DATA, (payload: any) => {
      const serverPayload = payload as ServerMapDataPayload;
      console.log(
        "[GameClient] Received MAP_DATA for map",
        serverPayload.mapId
      );

      // Increment generation to invalidate any in-flight MAP_ACTORS handler
      this.mapGeneration++;
      this.mapTransitioning = true;

      try {
        const mapData = loadMapDataFromServer(serverPayload);
        this.currentMapId = serverPayload.mapId;

        // Reset movement state — a map change interrupts any in-progress movement
        this.isMoving = false;

        // Build pathfinding from cell data
        const walkableIds = mapData.cells
          .filter((c) => c.walkable)
          .map((c) => c.id);
        this.pathfinding = new DofusPathfinding(
          mapData.width,
          mapData.height,
          walkableIds
        );
        console.log(
          "[GameClient] Pathfinding built:",
          walkableIds.length,
          "walkable cells"
        );

        // Log trigger cell IDs
        const triggerCellIds = mapData.triggerCellIds ?? [];
        if (triggerCellIds.length > 0) {
          console.log(
            `[GameClient] Trigger cells (${triggerCellIds.length}):`,
            triggerCellIds.join(", ")
          );
        } else {
          console.log("[GameClient] No trigger cells on this map");
        }

        if (this.battlefield) {
          // Store the promise so MAP_ACTORS can wait for map rendering to finish
          this.mapLoadPromise = this.battlefield.loadMapFromData(mapData);
          this.battlefield.updateMinimapPosition(serverPayload.mapId);
        }
      } catch (err) {
        console.error("[GameClient] Failed to decompress map data:", err);
      }
    });

    // MAP_ACTORS — existing actors on the map
    this.messageHandler.on(
      ServerMessageType.MAP_ACTORS,
      async (payload: any) => {
        const actors: ActorAddPayload[] = payload.actors ?? [];
        const generation = this.mapGeneration;
        console.log("[GameClient] MAP_ACTORS:", actors.length, "actors", "gen:", generation);

        if (!this.battlefield) return;

        // Wait for map to finish rendering before adding actors
        await this.mapLoadPromise;

        // If a newer MAP_DATA arrived while we were waiting, abort — the newer
        // MAP_ACTORS handler will take care of revealing the correct map.
        if (generation !== this.mapGeneration) {
          console.log("[GameClient] MAP_ACTORS gen", generation, "stale (current:", this.mapGeneration, "), skipping");
          return;
        }

        // Destroy old actor container and create a fresh one for the new map.
        // This is the ONLY moment actors are removed — minimizing the visible gap.
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
          });
          spritePromises.push(promise);

          // Sync current cell from server after map change
          if (isCurrentPlayer) {
            this.currentCellId = actor.cellId;
          }
        }

        // Wait for all sprites to load (or fail).
        await Promise.allSettled(spritePromises);

        // Check generation again — another MAP_DATA may have arrived during sprite loading
        if (generation !== this.mapGeneration) {
          console.log("[GameClient] MAP_ACTORS gen", generation, "stale after sprites, skipping");
          return;
        }

        this.mapTransitioning = false;
        this.battlefield.revealMap();
      }
    );

    // ACTOR_ADD — new actor joined the map
    this.messageHandler.on(ServerMessageType.ACTOR_ADD, (payload: any) => {
      const actor = payload as ActorAddPayload;
      console.log("[GameClient] ACTOR_ADD:", actor.name ?? actor.id);

      // Push to ECS command queue for NetworkIngestSystem
      this.gameWorld?.pushCommand({
        type: ServerMessageType.ACTOR_ADD,
        payload: actor,
        timestamp: Date.now(),
      });

      // Skip visual add during map transitions — MAP_ACTORS will provide the full list
      if (this.mapTransitioning) {
        console.log("[GameClient] ACTOR_ADD skipped during map transition");
        return;
      }

      this.battlefield?.addWorldActor({
        id: actor.id,
        name: actor.name ?? `Player ${actor.id}`,
        cellId: actor.cellId,
        direction: actor.direction,
        look: actor.look ?? "",
        isCurrentPlayer: actor.id === this.currentCharacter?.id,
      });
    });

    // ACTOR_REMOVE — actor left the map
    this.messageHandler.on(ServerMessageType.ACTOR_REMOVE, (payload: any) => {
      const data = payload as ActorRemovePayload;
      console.log("[GameClient] ACTOR_REMOVE:", data.id);

      this.gameWorld?.pushCommand({
        type: ServerMessageType.ACTOR_REMOVE,
        payload: data,
        timestamp: Date.now(),
      });

      this.battlefield?.removeWorldActor(data.id);
    });

    // ACTOR_MOVE — actor moved on the map
    this.messageHandler.on(
      ServerMessageType.ACTOR_MOVE,
      async (payload: any) => {
        const moveData = payload as ActorMovePayload;
        const { id, path } = moveData;

        this.gameWorld?.pushCommand({
          type: ServerMessageType.ACTOR_MOVE,
          payload: moveData,
          timestamp: Date.now(),
        });

        if (id === this.currentCharacter?.id && path.length > 0) {
          this.isMoving = true;
        }
        await this.battlefield?.moveWorldActor(id, path);
        if (id === this.currentCharacter?.id && path.length > 0) {
          this.currentCellId = path[path.length - 1];
          this.isMoving = false;
          // Signal server that walk animation is complete
          this.connection.send(
            encodeMessage(ClientMessageType.CHARACTER_MOVE_END, {}),
          );
        }
      }
    );
  }

  setBattlefield(battlefield: Battlefield): void {
    this.battlefield = battlefield;
    this.gameWorld = battlefield.getGameWorld();
    this.battlefield.setOnCellClick((cellId) => this.handleCellClick(cellId));
    this.battlefield.setOnMinimapTeleport((mapId) => this.handleMinimapTeleport(mapId));
    this.battlefield.setOnBoostStat((statId) => this.boostStat(statId));

    // If stats were received before battlefield was set, update the panel now
    if (this.currentStats) {
      this.battlefield.getStatsPanel()?.updateStats(this.currentStats);
    }
  }

  private handleMinimapTeleport(mapId: number): void {
    if (this.currentMapId === mapId) return;
    console.log(`[GameClient] Minimap teleport to map ${mapId}`);
    this.changeMap(mapId);
  }

  private handleCellClick(targetCellId: number): void {
    if (this.currentCellId === null || !this.pathfinding || this.isMoving)
      return;

    const path = this.pathfinding.findPath(this.currentCellId, targetCellId);
    if (!path || path.length < 2) return;

    console.log(
      "[GameClient] Moving:",
      this.currentCellId,
      "→",
      targetCellId,
      `(${path.length - 1} steps)`
    );
    this.move(path);
  }

  connect(): void {
    this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  login(username: string, password: string): void {
    this.connection.send(
      encodeMessage(ClientMessageType.AUTH_LOGIN, {
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
      encodeMessage(ClientMessageType.CHARACTER_SELECT, { characterId })
    );
  }

  move(path: number[]): void {
    this.connection.send(
      encodeMessage(ClientMessageType.CHARACTER_MOVE, { path })
    );
  }

  changeMap(mapId: number): void {
    this.connection.send(
      encodeMessage(ClientMessageType.MAP_CHANGE, { mapId })
    );
  }

  boostStat(statId: number): void {
    this.connection.send(
      encodeMessage(ClientMessageType.CHARACTER_BOOST_STAT, { statId })
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

  /** Debug: give capital points (persisted server-side) */
  debugGiveCapital(amount: number): void {
    this.connection.send(
      encodeMessage(ClientMessageType.DEBUG_GIVE_CAPITAL, { amount })
    );
  }

  // Event callbacks
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
    this.battlefield = null;
  }
}
