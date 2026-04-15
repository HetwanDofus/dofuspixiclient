import { create } from "@bufbuild/protobuf";
import { match } from "ts-pattern";

import type { Battlefield } from "@/game/scene";
import type { InventoryStore } from "@/game/stores/inventory-store";
import type { CharacterStats } from "@/game/types/stats";
import { AudioManager } from "@/game/audio/audio-manager";
import { derivePasswordKey } from "@/game/auth/pbkdf2";
import { loginActor } from "@/game/machines/actors";
import { Connection, type ConnectionEvent } from "@/game/network/connection";
import { AuthHandler } from "@/game/network/handlers/auth.handler";
import {
  CharacterHandler,
  type CharacterInfo,
} from "@/game/network/handlers/character.handler";
import { FightHandler } from "@/game/network/handlers/fight.handler";
import { InventoryHandler } from "@/game/network/handlers/inventory.handler";
import { MapHandler } from "@/game/network/handlers/map.handler";
import {
  createMessageHandler,
  type MessageHandler,
} from "@/game/network/message-handler";
import {
  AccountGetCharactersListSchema,
  AccountGetServersListSchema,
  AccountSelectCharacterSchema,
  AccountSelectServerRequestSchema,
  AccountSendIdentitySchema,
  AccountSendTicketSchema,
  encodeClient,
  GameActionRequestSchema,
  GameCreateRequestSchema,
  ItemDestroyRequestSchema,
  ItemDropRequestSchema,
  ItemMoveRequestSchema,
  ItemUseRequestSchema,
} from "@/game/network/protocol";
import { characterStore } from "@/game/stores";
import { createLogger } from "@/utils/logger";

export type { CharacterInfo } from "@/game/network/handlers/character.handler";

export interface GameClientConfig {
  serverUrl?: string;
}

const log = createLogger("GameClient");

/**
 * Composition root for the network layer:
 *   Connection → MessageHandler → per-domain handlers → stores + machines.
 */
export class GameClient {
  private readonly connection: Connection;
  private readonly messageHandler: MessageHandler;
  private readonly audioManager: AudioManager;

  private readonly authHandler: AuthHandler;
  private readonly characterHandler: CharacterHandler;
  private readonly inventoryHandler: InventoryHandler;
  private readonly fightHandler: FightHandler;
  private readonly mapHandler: MapHandler;

  private battlefield: Battlefield | null = null;

  private onConnected?: () => void;
  private onDisconnected?: () => void;

  constructor(config?: GameClientConfig) {
    this.connection = new Connection({
      url: config?.serverUrl ?? "ws://localhost:4444/game",
    });
    this.messageHandler = createMessageHandler();
    this.audioManager = AudioManager.getInstance();
    this.audioManager.init();

    this.authHandler = new AuthHandler(this.messageHandler);
    this.characterHandler = new CharacterHandler(this.messageHandler, {
      onCharacterSelected: (character) => {
        this.battlefield?.setDebugPlayerId(character.id);
      },
    });
    this.inventoryHandler = new InventoryHandler(this.messageHandler);
    this.fightHandler = new FightHandler(this.messageHandler, this.connection);
    this.mapHandler = new MapHandler(
      this.messageHandler,
      this.connection,
      this.audioManager,
      this.characterHandler,
      () => this.battlefield
    );

    this.connection.addEventListener((event: ConnectionEvent) => {
      match(event)
        .with({ type: "connected" }, () => {
          log.info("Connected");
          // If we connected as part of an authd→gamed pivot, the ticket
          // is queued up; flush it as the first frame so gamed binds the
          // session to our account before any character query.
          if (this.pendingTicket) {
            const ticket = this.pendingTicket;
            this.pendingTicket = null;
            log.info("Sending auth ticket to gamed");
            this.connection.send(
              encodeClient(
                "accountSendTicket",
                create(AccountSendTicketSchema, { ticket })
              )
            );
          }
          this.onConnected?.();
        })
        .with({ type: "disconnected" }, (e) => {
          log.info("Disconnected:", e.reason);
          // Suppress LOGOUT on intentional pivot disconnects — we'll
          // reconnect in a moment to gamed and the auth state must
          // survive the gap.
          if (this.pivotInFlight) {
            this.onDisconnected?.();
            return;
          }
          loginActor.send({ type: "LOGOUT" });
          this.onDisconnected?.();
        })
        .with({ type: "message" }, (e) => {
          this.messageHandler.handle(e.message);
        })
        .otherwise(() => {});
    });

    // Listen for AccountSelectServer success on the SAME message bus the
    // AuthHandler uses; trigger the authd→gamed pivot here so callers
    // don't have to thread payloads through the actor.
    this.messageHandler.on("accountSelectServer", (payload) => {
      if (!payload.success || !payload.ip || !payload.port || !payload.ticket) {
        return;
      }
      this.pivotToGame(payload.ip, payload.port, payload.ticket);
    });

    // After the server confirms our character, request roleplay mode so
    // gamed starts streaming map + sprite data. Dofus 1.29 wire: GC1.
    this.messageHandler.on("accountCharacterSelected", (payload) => {
      if (!payload.success) {
        return;
      }
      log.info("Entering world (GameCreate type=1)");
      this.connection.send(
        encodeClient(
          "gameCreate",
          create(GameCreateRequestSchema, { type: 1 })
        )
      );
    });
  }

  // pivotToGame disconnects from authd and reconnects to the gamed
  // address returned in AccountSelectServer. The ticket is queued and
  // sent as the first frame on the new connection.
  private pendingTicket: string | null = null;
  private pivotInFlight = false;
  private pivotToGame(host: string, port: number, ticket: string): void {
    const url = `ws://${host}:${port}/game`;
    log.info(`Pivoting to gamed at ${url}`);
    this.pendingTicket = ticket;
    this.pivotInFlight = true;
    this.connection.disconnect();
    this.connection.setUrl(url);
    // Reconnect on the next tick so the close event lands first.
    setTimeout(() => {
      this.pivotInFlight = false;
      this.connection.connect();
    }, 50);
  }

  setBattlefield(battlefield: Battlefield): void {
    this.battlefield = battlefield;
    battlefield.setOnCellClick((cellId) => this.handleCellClick(cellId));

    const stats = this.characterHandler.getCurrentStats();
    if (stats) {
      characterStore.setState({ stats });
    }

    // gameMapData / gameMovement frames that arrived before the battlefield
    // was initialised have been buffered — replay them now.
    this.mapHandler.flushPending();
  }

  // ── Connection lifecycle ─────────────────────────────────────────

  connect(): void {
    this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  setOnConnected(fn: () => void): void {
    this.onConnected = fn;
  }

  setOnDisconnected(fn: () => void): void {
    this.onDisconnected = fn;
  }

  // ── Pre-game commands ────────────────────────────────────────────

  async login(username: string, password: string): Promise<void> {
    const passwordKey = await derivePasswordKey(password, username);
    loginActor.send({ type: "START_LOGIN", username });
    this.connection.send(
      encodeClient(
        "accountSendIdentity",
        create(AccountSendIdentitySchema, {
          username,
          encryptedPassword: passwordKey,
        })
      )
    );
  }

  requestServers(): void {
    this.connection.send(
      encodeClient("accountGetServers", create(AccountGetServersListSchema, {}))
    );
  }

  selectServer(serverId: number): void {
    loginActor.send({ type: "SELECT_SERVER", serverId });
    this.connection.send(
      encodeClient(
        "accountSelectServer",
        create(AccountSelectServerRequestSchema, { serverId })
      )
    );
  }

  requestCharacters(): void {
    this.connection.send(
      encodeClient(
        "accountGetCharacters",
        create(AccountGetCharactersListSchema, { forced: false })
      )
    );
  }

  selectCharacter(characterId: number): void {
    loginActor.send({ type: "SELECT_CHARACTER", characterId });
    this.connection.send(
      encodeClient(
        "accountSelectCharacter",
        create(AccountSelectCharacterSchema, { characterId })
      )
    );
  }

  // ── In-game commands ─────────────────────────────────────────────
  // Each outbound action is a GameActionRequest with a semicolon-separated
  // params string — the legacy Dofus 1.29 wire format the server still
  // speaks on the ingress side. Full native-proto client actions will land
  // when the server's request side migrates away from GA-style strings.

  move(path: number[]): void {
    const params = path.join(",");
    this.connection.send(
      encodeClient(
        "gameAction",
        create(GameActionRequestSchema, { actionType: 1, params })
      )
    );
  }

  changeMap(mapId: number): void {
    this.connection.send(
      encodeClient(
        "gameAction",
        create(GameActionRequestSchema, {
          actionType: 2,
          params: String(mapId),
        })
      )
    );
  }

  moveItem(unicId: number, position: number, quantity = 1): void {
    this.connection.send(
      encodeClient(
        "itemMove",
        create(ItemMoveRequestSchema, {
          itemUnicId: unicId,
          position,
          quantity,
        })
      )
    );
  }

  useItem(unicId: number): void {
    this.connection.send(
      encodeClient(
        "itemUse",
        create(ItemUseRequestSchema, { itemUnicId: unicId })
      )
    );
  }

  dropItem(unicId: number, quantity: number): void {
    this.connection.send(
      encodeClient(
        "itemDrop",
        create(ItemDropRequestSchema, { itemUnicId: unicId, quantity })
      )
    );
  }

  destroyItem(unicId: number, quantity: number): void {
    this.connection.send(
      encodeClient(
        "itemDestroy",
        create(ItemDestroyRequestSchema, { itemUnicId: unicId, quantity })
      )
    );
  }

  private handleCellClick(targetCellId: number): void {
    const currentCellId = this.mapHandler.getCurrentCellId();
    const pathfinding = this.mapHandler.getPathfinding();
    if (
      currentCellId === null ||
      !pathfinding ||
      this.mapHandler.isCharacterMoving()
    ) {
      return;
    }
    const path = pathfinding.findPath(currentCellId, targetCellId);
    if (!path || path.length < 2) {
      return;
    }
    log.debug(`Moving: ${currentCellId} → ${targetCellId}`);
    this.move(path);
  }

  // ── Accessors ────────────────────────────────────────────────────

  getCurrentCharacter(): CharacterInfo | null {
    return this.characterHandler.getCurrentCharacter();
  }

  getCurrentMapId(): number | null {
    return this.mapHandler.getCurrentMapId();
  }

  getCurrentStats(): CharacterStats | null {
    return this.characterHandler.getCurrentStats();
  }

  getAudioManager(): AudioManager {
    return this.audioManager;
  }

  getInventory(): InventoryStore {
    return this.inventoryHandler.store;
  }

  getAuthState() {
    return this.authHandler.getState();
  }

  destroy(): void {
    this.connection.destroy();
    this.messageHandler.clear();
    this.audioManager.destroy();
    this.fightHandler.destroy();
    this.battlefield = null;
  }
}
