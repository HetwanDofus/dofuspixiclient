import type { DofusPathfinding } from "@dofus/grid";
import type { MonsterGroupMember, MountDisplay } from "@dofus/proto";
import { Container } from "pixi.js";

import type { CharacterSpriteLoader } from "@/game/assets/character-sprite";
import type { CellData } from "@/game/datacenter/cell";
import type { MapScale } from "@/game/datacenter/map";
import type { PickingSystem } from "@/game/render/picking-system";
import type { RendererRegistry } from "@/game/render/renderer-registry";
import type { MapHandler } from "@/game/scene/map/handler";
import type { Scene } from "@/game/scene/scene";
import { PlayerRenderer } from "@/game/scene/player/renderer";
import { fightStore } from "@/game/stores/fight-store";

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
   * For SPRITE_TYPE_MONSTER_GROUP sprites: difficulty bonus mirroring
   * `MonsterGroup._nBonusValue` (canonical 5-star colouring). Forwarded
   * to the picking layer so the hover panel can colour the stars.
   */
  monsterGroupBonus?: number;
  /**
   * Server-authoritative team (0 = defender/red, 1 = attacker/blue).
   * Absent during roleplay (no team concept); passed through from
   * SpriteMovementEntry.team during fight placement / combat so the
   * team-colored ground ring reads correctly per fighter.
   */
  team?: number;
  /**
   * Per-actor sprite scale (1 = life size), from the entry's `scale_x`.
   * Only NPCs ship anything other than 100 today.
   */
  scale?: number;
  /**
   * SPRITE_TYPE_NPC only: the NPC *template* id. Keys the `npc` lang
   * bundle (`N.d[id].a`) that the action bubble is built from, and marks
   * the actor as an NPC for the picking layer — which otherwise reads a
   * negative sprite id as "monster group" and walks the player into it.
   */
  npcTemplateId?: number;
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
  /**
   * Scale and centring offset the tile layers bake into every sprite
   * position (`computeMapScale`). Actors have to be placed through the
   * same transform or they drift off the terrain on any map that is not
   * 15x17 — a fifth of the world.
   */
  currentMapScale(): MapScale;
  transparencyEnabled(): boolean;
  applyTransparency(): void;
  registerPlayerForPicking(
    playerId: number,
    renderer: PlayerRenderer,
    monsterGroup?: MonsterGroupMember[],
    isCurrentPlayer?: boolean,
    monsterGroupBonus?: number,
    /**
     * Player IDs of every sprite that visually belongs to the same
     * monster group as `playerId` (leader + decorative siblings).
     * When the user rolls over ANY of these sprites the picking
     * handler highlights ALL of them at once — that's how a group
     * looks like a single hoverable unit instead of a pile of
     * individually-pickable sprites.
     */
    groupSpriteIds?: number[],
    /** SPRITE_TYPE_NPC only — keys the action bubble's lang lookup. */
    npcTemplateId?: number
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

  /**
   * Push the current map's width and centring transform into the renderer,
   * so actors are projected exactly like the tiles under them.
   *
   * Deliberately *not* `setOffset`/`setScale`: those transform the
   * renderer's container, and in world mode that container IS the shared
   * object-layer-2 tile container (see `init`) — moving it would drag
   * every piece of furniture along. The transform has to reach the actor
   * positions instead.
   *
   * Must be re-applied after every map load: `reset()` runs *before* the
   * scene stores the new `MapData`, so a renderer built there is still
   * holding the previous map's geometry.
   */
  applyMapTransform(): void {
    const renderer = this.renderer;

    if (!renderer) {
      return;
    }

    renderer.setMapDimensions(this.deps.currentMapWidth());
    renderer.setMapProjection(this.deps.currentMapScale());
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
    // Read authoritative HP from the fight store. FIGHTER_UPSERT runs
    // BEFORE this addWorldActor (both fan out from the same
    // gameMovement frame, but fightHandler subscribes first), so the
    // store already carries hp/maxHp by the time we register the
    // sprite. Falling back to (100, 100) keeps the bar visible during
    // roleplay (no fighter entry) without being authoritative there.
    const fighter = fightStore.getSnapshot().fighters.get(String(data.id));
    const hp = fighter?.hp ?? 100;
    const maxHp = fighter?.maxHp ?? 100;

    // Every non-leader member of a monster group rides along as a linked
    // child. Canonical 1.29 does exactly this under `ViewAllMonsterInGroup`
    // (`GameIn.as:232-274` → `addLinkedSprite`): each member is given one of
    // the eight slots in the ring of cells around the group's cell
    // (`Pathfinding.getArroundCellNum`, transcribed here as
    // `PlayerMovement.aroundCell`). The previous approach nudged siblings by
    // 16-40 px on the *same* cell, so an eight-mob group overlapped into
    // three or four readable sprites and the count never matched the fight.
    const groupMembers = data.monsterGroup ?? [];
    const linkedChildren =
      groupMembers.length > 1
        ? groupMembers.slice(1).map((m, i) => ({
            gfxId: m.gfxId,
            // Slot 0 is directly behind the leader, then around the ring.
            // A full group of 8 fills slots 0-6 and nothing overlaps.
            childIndex: i % 8,
            color1: m.color1,
            color2: m.color2,
            color3: m.color3,
          }))
        : data.linkedChildren;

    await (this.renderer?.addPlayer({
      id: data.id,
      name: data.name,
      team,
      cellId: data.cellId,
      direction: data.direction,
      look: data.look,
      hp,
      maxHp,
      isPlayer: data.isCurrentPlayer,
      // AS2 `instanceof dofus.datacenter.Character` — true for any
      // player avatar (local + other PCs), false for monster groups
      // and NPCs. Drives the run-vs-walk threshold (3 vs 6) in
      // getRunLimit.
      isCharacter: !data.monsterGroup && data.npcTemplateId === undefined,
      linkedChildren,
      mount: data.mount,
      ...(data.scale !== undefined ? { scale: data.scale } : {}),
    }) ?? Promise.resolve());

    // If the player already existed (addPlayer short-circuits on
    // duplicate ids), make sure the team mirrors whatever the server
    // just told us — team can legitimately change when a roleplay
    // actor transitions into a fight sprite.
    if (data.team !== undefined) {
      this.renderer?.updatePlayerTeam(data.id, data.team);
    }

    // The child ids are allocated inside the renderer, so read them back
    // rather than recomputing them. Hover and click must treat the whole
    // group as one unit: every sprite registers the same roster, the same
    // bonus and the same id list, so rolling over any member highlights
    // all of them — which is what canonical achieves by walking up
    // `linkedParent` in `DofusBattlefield.onSpriteRollOut`.
    const childIds = this.renderer?.getLinkedChildIds(data.id) ?? [];
    const groupSpriteIds: number[] | undefined =
      groupMembers.length > 1 ? [data.id, ...childIds] : undefined;

    if (this.renderer) {
      this.deps.registerPlayerForPicking(
        data.id,
        this.renderer,
        data.monsterGroup,
        data.isCurrentPlayer,
        data.monsterGroupBonus,
        groupSpriteIds,
        data.npcTemplateId
      );

      if (groupSpriteIds) {
        for (const childId of childIds) {
          this.deps.registerPlayerForPicking(
            childId,
            this.renderer,
            data.monsterGroup,
            false,
            data.monsterGroupBonus,
            groupSpriteIds
          );
        }
      }
    }

    this.deps.markPickingDirty();
  }

  /** Look changes (equip/unequip) — re-render the actor with new accessories. */
  updateLook(id: number, look: string): void {
    this.renderer?.updatePlayer(id, { look });
  }

  remove(id: number): void {
    // A monster group's members are linked children of the leader, so
    // `PlayerRenderer.cleanupPlayer` already removes their sprites when the
    // leader goes. Their picking entries are ours to drop, though — the
    // server only ever fires REMOVE for the leader's sprite id, when the
    // group is consumed for a fight or the player leaves the map.
    for (const childId of this.renderer?.getLinkedChildIds(id) ?? []) {
      this.deps.unregisterPlayerFromPicking(childId);
    }
    this.deps.unregisterPlayerFromPicking(id);
    this.renderer?.removePlayer(id);
  }

  /** Stop a walking actor at the next cell; returns it, or null. */
  interrupt(id: number): number | null {
    return this.renderer?.interruptPlayer(id) ?? null;
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
    this.fightStoreUnsub?.();
    this.fightStoreUnsub = null;
  }

  private fightStoreUnsub: (() => void) | null = null;

  private init(): void {
    const mapContainer = this.deps.mapContainer();

    if (!mapContainer) {
      return;
    }

    this.renderer?.destroy();
    this.renderer = null;
    this.fightStoreUnsub?.();
    this.fightStoreUnsub = null;

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

    this.applyMapTransform();

    this.deps
      .rendererRegistry()
      .register("world-actor-renderer", (e) => this.renderer?.onResize(e));

    // Mirror the fight store's hp/maxHp into each fighter's overhead
    // panel. The store is the single source of truth (FIGHTER_UPSERT
    // on placement, FIGHTER_UPDATE on damage / heal / turn snapshots),
    // so every store change must reach the renderer or the bar drifts
    // out of sync (was the user's "HP bar goes to 0 after any damage"
    // bug — onDamage's local delta computation was racing with the
    // store update fired right after).
    let lastHpKey = new Map<string, string>();
    this.fightStoreUnsub = fightStore.subscribe(() => {
      const renderer = this.renderer;
      if (!renderer) return;
      for (const f of fightStore.getSnapshot().fighters.values()) {
        const numericId = Number(f.spriteId);
        if (!Number.isFinite(numericId)) continue;
        const key = `${f.hp}/${f.maxHp}`;
        if (lastHpKey.get(f.spriteId) === key) continue;
        lastHpKey.set(f.spriteId, key);
        renderer.updatePlayer(numericId, { hp: f.hp, maxHp: f.maxHp });
      }
    });
  }
}
