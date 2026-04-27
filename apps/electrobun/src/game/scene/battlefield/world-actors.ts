import type { DofusPathfinding } from "@dofus/grid";
import type { MonsterGroupMember, MountDisplay } from "@dofus/proto";
import { Container } from "pixi.js";

import type { CharacterSpriteLoader } from "@/game/assets/character-sprite";
import type { CellData } from "@/game/datacenter/cell";
import type { PickingSystem } from "@/game/render/picking-system";
import type { RendererRegistry } from "@/game/render/renderer-registry";
import type { MapHandler } from "@/game/scene/map/handler";
import type { Scene } from "@/game/scene/scene";
import { PlayerRenderer } from "@/game/scene/player/renderer";

export interface WorldActorData {
  id: number;
  name: string;
  cellId: number;
  direction: number;
  look: string;
  isCurrentPlayer: boolean;
  linkedChildren?: Array<{ gfxId: number; childIndex: number }>;
  mount?: MountDisplay;
  /**
   * For SPRITE_TYPE_MONSTER_GROUP sprites: the per-member roster so the
   * world-map hover tooltip can show name / level / gfx of each
   * monster in the group before the player engages.
   */
  monsterGroup?: MonsterGroupMember[];
  /**
   * Server-authoritative team (0 = defender/red, 1 = attacker/blue).
   * Absent during roleplay (no team concept); passed through from
   * SpriteMovementEntry.team during fight placement / combat so the
   * team-colored ground ring reads correctly per fighter.
   */
  team?: number;
}

export interface BattlefieldWorldActorsDeps {
  mapContainer(): Container | null;
  mapHandler(): MapHandler | null;
  scene(): Scene;
  characterSpriteLoader(): CharacterSpriteLoader;
  pickingSystem(): PickingSystem | null;
  pathfinding(): DofusPathfinding | null;
  cellDataMap(): Map<number, CellData>;
  rendererRegistry(): RendererRegistry;
  currentMapWidth(): number;
  transparencyEnabled(): boolean;
  applyTransparency(): void;
  registerPlayerForPicking(
    playerId: number,
    renderer: PlayerRenderer,
    monsterGroup?: MonsterGroupMember[]
  ): void;
  unregisterPlayerFromPicking(playerId: number): void;
  markPickingDirty(): void;
}

/**
 * Owns the "roleplay mode" player/NPC layer of the battlefield.
 * Controls one PlayerRenderer that lives inside objectLayer2 so world actors
 * interleave with foreground tiles by zIndex.
 */
export class BattlefieldWorldActors {
  private container: Container | null = null;
  private renderer: PlayerRenderer | null = null;

  constructor(private readonly deps: BattlefieldWorldActorsDeps) {}

  getRenderer(): PlayerRenderer | null {
    return this.renderer;
  }

  /** Recreate the renderer (e.g. after map change, before MAP_ACTORS batch). */
  reset(): void {
    this.init();
  }

  async add(data: WorldActorData): Promise<void> {
    if (!this.renderer) {
      this.init();
    }

    // Prefer the server's authoritative team (fight mode sets it from
    // SpriteMovementEntry.team). In roleplay no team is shipped, so we
    // fall back to the original "blue for self, red for others"
    // heuristic — it only affects the placeholder swatch, which is
    // hidden the moment the real sprite loads.
    const team = data.team ?? (data.isCurrentPlayer ? 1 : 0);

    await (this.renderer?.addPlayer({
      id: data.id,
      name: data.name,
      team,
      cellId: data.cellId,
      direction: data.direction,
      look: data.look,
      hp: 100,
      maxHp: 100,
      isPlayer: data.isCurrentPlayer,
      linkedChildren: data.linkedChildren,
      mount: data.mount,
    }) ?? Promise.resolve());

    // If the player already existed (addPlayer short-circuits on
    // duplicate ids), make sure the team mirrors whatever the server
    // just told us — team can legitimately change when a roleplay
    // actor transitions into a fight sprite.
    if (data.team !== undefined) {
      this.renderer?.updatePlayerTeam(data.id, data.team);
    }

    if (this.renderer) {
      this.deps.registerPlayerForPicking(
        data.id,
        this.renderer,
        data.monsterGroup
      );
    }

    this.deps.markPickingDirty();
  }

  /** Look changes (equip/unequip) — re-render the actor with new accessories. */
  updateLook(id: number, look: string): void {
    this.renderer?.updatePlayer(id, { look });
  }

  remove(id: number): void {
    this.deps.unregisterPlayerFromPicking(id);
    this.renderer?.removePlayer(id);
  }

  async move(id: number, path: number[]): Promise<void> {
    await this.renderer?.movePlayer(id, path);
  }

  clear(): void {
    this.renderer?.clear();
  }

  destroy(): void {
    this.renderer?.destroy();
    this.renderer = null;
    this.container = null;
  }

  private init(): void {
    const mapContainer = this.deps.mapContainer();

    if (!mapContainer) {
      return;
    }

    this.renderer?.destroy();
    this.renderer = null;

    const objectLayer2 = this.deps.mapHandler()?.getObjectLayer2();
    this.container = objectLayer2 ?? new Container();

    if (!objectLayer2) {
      this.container.label = "world-actors";
      this.container.sortableChildren = true;
      mapContainer.addChild(this.container);
    }

    if (this.deps.transparencyEnabled()) {
      this.deps.applyTransparency();
    }

    this.renderer = new PlayerRenderer(this.container, {
      mapWidth: this.deps.currentMapWidth(),
      groundLevel: 7,
      cellDataMap: this.deps.cellDataMap(),
      spriteLoader: this.deps.characterSpriteLoader(),
      pickingSystem: this.deps.pickingSystem(),
      pathfinding: this.deps.pathfinding(),
      scene: this.deps.scene(),
    });

    this.deps
      .rendererRegistry()
      .register("world-actor-renderer", (e) => this.renderer?.onResize(e));
  }
}
