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
    groupSpriteIds?: number[]
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
  // leader id → ids of decorative sibling sprites painted around it.
  // Used by `remove()` to tear the stack down atomically when the
  // server consumes the group for a fight.
  private readonly groupSiblings = new Map<number, number[]>();

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
      // player avatar (local + other PCs), false for monster groups.
      // Drives the run-vs-walk threshold (3 vs 6) in getRunLimit.
      isCharacter: !data.monsterGroup,
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

    // Build the full sprite-id list for this monster group up front so
    // both the leader's picking entry AND every sibling's entry can
    // share the same array. On hover, the picking handler iterates
    // this list to highlight every group sprite at once.
    const groupSpriteIds: number[] | undefined =
      data.monsterGroup && data.monsterGroup.length > 1
        ? this.computeGroupSpriteIds(data.id, data.monsterGroup.length)
        : undefined;

    if (this.renderer) {
      this.deps.registerPlayerForPicking(
        data.id,
        this.renderer,
        data.monsterGroup,
        data.isCurrentPlayer,
        data.monsterGroupBonus,
        groupSpriteIds
      );
    }

    // Spawn decorative sibling sprites for every non-leader member of a
    // monster group so the player can see the full group composition on
    // the map. Canonical 1.29 renders just the leader's gfx file; this
    // is a UX enhancement (the canonical "stack" effect appears in
    // Retro / private servers and is what the user explicitly asked
    // for). Each sibling registers with the same group roster + bonus
    // so hovering or clicking any one of them surfaces the same panel
    // and routes to the same fight-trigger cell.
    if (
      data.monsterGroup &&
      data.monsterGroup.length > 1 &&
      this.renderer
    ) {
      await this.spawnGroupSiblings(data, team, groupSpriteIds);
    }

    this.deps.markPickingDirty();
  }

  /**
   * Renders one extra sprite per non-leader member of a monster group.
   * Sub-actor IDs derive from the leader's id (`data.id * 10000 - i`) —
   * outside the range any real player / monster id can hit (group ids
   * are negative, players positive), so collisions are impossible.
   */
  /**
   * Returns `[leaderId, ...siblingIds]` for a group of `memberCount`
   * monsters. Mirrors the sibling-id formula used in
   * `spawnGroupSiblings` (`leaderId * 10000 - i` for i in 1..N-1).
   */
  private computeGroupSpriteIds(
    leaderId: number,
    memberCount: number
  ): number[] {
    const out: number[] = [leaderId];
    for (let i = 1; i < memberCount; i++) {
      out.push(leaderId * 10000 - i);
    }
    return out;
  }

  private async spawnGroupSiblings(
    data: WorldActorData,
    team: number,
    groupSpriteIds?: number[]
  ): Promise<void> {
    const renderer = this.renderer;
    const members = data.monsterGroup;
    if (!renderer || !members || members.length <= 1) {
      return;
    }

    const siblingIds: number[] = [];
    const promises: Promise<void>[] = [];
    // Skip index 0 — that's the leader rendered by the parent `add()`.
    for (let i = 1; i < members.length; i++) {
      const m = members[i];
      const subId = data.id * 10000 - i;
      siblingIds.push(subId);
      // Deterministic offset so re-renders don't shuffle. Spread a
      // half-cell (Dofus iso footprint ≈ 86 × 43 px) in front-to-back
      // diamond around the leader: alternating left / right and a
      // shallow front/back spread keeps the cluster readable rather
      // than a tower or a single row.
      const seq = i - 1; // 0-indexed sibling
      const side = seq % 2 === 0 ? 1 : -1;
      const lane = Math.floor(seq / 2) + 1;
      const ox = side * (10 + lane * 6);
      const oy = lane * 4 - (seq % 2 === 0 ? 2 : -2);

      const memberLook = `${m.gfxId}|${m.color1}|${m.color2}|${m.color3}|`;

      // Each sibling routes its hover / click to the same group panel.
      // We register every one with the FULL roster + bonus so the
      // hover handler doesn't have to know which sub-sprite was hit.
      //
      // CRITICAL: register picking AFTER the sprite finishes loading.
      // `addPlayer` returns a Promise that resolves once the
      // CharacterSprite atlas is ready (`f.sprite` is null until then),
      // and our picking system's hit-test reads `sprite.texture` —
      // null sprite = silent skip = no hover ever fires. The leader
      // had the same race but was masked because its sprite usually
      // loads from cache; siblings load fresh atlases each time and
      // consistently lost their picking registration.
      promises.push(
        renderer
          .addPlayer({
            id: subId,
            name: "",
            team,
            cellId: data.cellId,
            direction: data.direction,
            look: memberLook,
            hp: 100,
            maxHp: 100,
            isPlayer: false,
            pixelOffset: { x: ox, y: oy },
            decorative: true,
          })
          .then(() => {
            this.deps.registerPlayerForPicking(
              subId,
              renderer,
              members,
              false,
              data.monsterGroupBonus,
              groupSpriteIds
            );
            this.deps.markPickingDirty();
          })
      );
    }

    if (siblingIds.length > 0) {
      this.groupSiblings.set(data.id, siblingIds);
    }
    await Promise.all(promises);
  }

  /** Look changes (equip/unequip) — re-render the actor with new accessories. */
  updateLook(id: number, look: string): void {
    this.renderer?.updatePlayer(id, { look });
  }

  remove(id: number): void {
    // Tear down decorative monster-group siblings alongside the leader
    // so the screen doesn't keep ghost sprites where the group used to
    // stand. Server fires REMOVE on the leader spriteId only when a
    // group is consumed for fight or the player leaves the map.
    const siblings = this.groupSiblings.get(id);
    if (siblings) {
      for (const sid of siblings) {
        this.deps.unregisterPlayerFromPicking(sid);
        this.renderer?.removePlayer(sid);
      }
      this.groupSiblings.delete(id);
    }
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
