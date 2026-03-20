import { type Entity, World } from "@lastolivegames/becsy";

import type { NetworkCommand } from "@/ecs/components";
import {
  ActiveEffect,
  ActorTag,
  Animated,
  CellPosition,
  CombatContext,
  DamageDisplay,
  EffectIndicator,
  Fighter,
  FighterLook,
  FighterStats,
  ForcedMovement,
  HoverState,
  Interactive,
  InteractionEvent,
  MovementAnimation,
  MovementPath,
  MovementRestriction,
  NetworkId,
  PendingDamage,
  PlayerTurnState,
  Position,
  Renderable,
  Rotation,
  Scale,
  Spell,
  SpellCooldown,
  SpellCost,
  SpellCritical,
  SpellStateRequirements,
  SpellZone,
  SpriteState,
  TeamPlacement,
  TeleportTarget,
  TileId,
  TileType,
  ZIndex,
} from "@/ecs/components";
import { RenderSystem } from "@/ecs/systems/render-system";
import {
  InteractionDispatchSystem,
} from "@/ecs/systems/interaction-dispatch-system";
import {
  NetworkIngestSystem,
  pushNetworkCommand,
} from "@/ecs/systems/network-ingest-system";

export interface GameWorldConfig {
  maxEntities?: number;
}

export class GameWorld {
  private world: World | null = null;
  private networkIdMap: Map<number, Entity> = new Map();
  private initialized = false;

  async init(config: GameWorldConfig = {}): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.world = await World.create({
      maxEntities: config.maxEntities ?? 100000,
      defs: [
        // Transform components
        Position,
        Scale,
        Rotation,
        ZIndex,

        // Network components
        NetworkId,

        // Tile components
        TileId,
        TileType,

        // Rendering components
        Renderable,
        Animated,
        Interactive,
        HoverState,

        // Interaction singleton
        InteractionEvent,

        // Combat - Fighter components
        Fighter,
        FighterStats,
        CellPosition,
        FighterLook,

        // Combat - State components
        CombatContext,
        PlayerTurnState,
        TeamPlacement,

        // Combat - Spell components
        Spell,
        SpellCost,
        SpellCooldown,
        SpellZone,
        SpellCritical,
        SpellStateRequirements,

        // Combat - Effect components
        ActiveEffect,
        EffectIndicator,
        PendingDamage,

        // Combat - Movement components
        MovementPath,
        MovementRestriction,
        ForcedMovement,
        TeleportTarget,

        // Actor components
        ActorTag,
        SpriteState,
        MovementAnimation,
        DamageDisplay,

        // Systems
        RenderSystem,
        InteractionDispatchSystem,
        NetworkIngestSystem,
      ],
    });

    // Run one tick so system.initialize() fires
    await this.world.execute();

    this.initialized = true;
  }

  /**
   * Push a network command to be processed by NetworkIngestSystem next frame.
   */
  pushCommand(command: NetworkCommand): void {
    pushNetworkCommand(command);
  }

  async execute(): Promise<void> {
    if (!this.world) {
      throw new Error("GameWorld not initialized");
    }

    await this.world.execute();
  }

  getWorld(): World {
    if (!this.world) {
      throw new Error("GameWorld not initialized");
    }

    return this.world;
  }

  createEntity(networkId?: number): Entity {
    if (!this.world) {
      throw new Error("GameWorld not initialized");
    }
    let entity!: Entity;
    this.world.build((sys) => {
      entity = sys.createEntity();
      if (networkId !== undefined) {
        entity.add(NetworkId, { value: networkId });
        this.networkIdMap.set(networkId, entity);
      }
    });
    return entity;
  }

  createTileEntity(params: {
    tileId: number;
    tileType: number;
    x: number;
    y: number;
    zIndex: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
  }): Entity {
    if (!this.world) {
      throw new Error("GameWorld not initialized");
    }
    let entity!: Entity;
    this.world.build((sys) => {
      entity = sys.createEntity(
        TileId,
        { value: params.tileId },
        TileType,
        { value: params.tileType },
        Position,
        { x: params.x, y: params.y },
        ZIndex,
        { value: params.zIndex },
        Scale,
        { x: params.scaleX ?? 1, y: params.scaleY ?? 1 },
        Rotation,
        { angle: params.rotation ?? 0 },
        Renderable,
        { sprite: null, visible: true, alpha: 1 },
      );
    });
    return entity;
  }

  getEntityByNetworkId(networkId: number): Entity | undefined {
    return this.networkIdMap.get(networkId);
  }

  removeEntityByNetworkId(networkId: number): void {
    const entity = this.networkIdMap.get(networkId);
    if (entity) {
      entity.delete();
      this.networkIdMap.delete(networkId);
    }
  }

  async destroy(): Promise<void> {
    if (this.world) {
      await this.world.terminate();
      this.world = null;
    }
    this.networkIdMap.clear();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

let gameWorldInstance: GameWorld | null = null;

export function getGameWorld(): GameWorld {
  if (!gameWorldInstance) {
    gameWorldInstance = new GameWorld();
  }
  return gameWorldInstance;
}

export async function resetGameWorld(): Promise<void> {
  if (gameWorldInstance) {
    await gameWorldInstance.destroy();
    gameWorldInstance = null;
  }
}
