import type { DofusPathfinding } from "@dofus/grid";
import { LayoutSystem } from "@pixi/layout";
import {
  type Application,
  type Container,
  extensions,
  TextureSource,
  Ticker,
} from "pixi.js";

import type { AdjacentMapCache } from "@/game/assets/adjacent-map-cache";
import type { InteractionHandler } from "@/game/input/interaction-handler";
import type { AtlasLoader } from "@/game/render/atlas-loader";
import type { PickingSystem } from "@/game/render/picking-system";
import type { SpellVelloRenderer } from "@/game/render/spell-vello-renderer";
import type { SpellAnimationConfig } from "@/game/scene/fight/spell-view";
import type {
  MapTransition,
  TransitionDirection,
} from "@/game/scene/map/transition";
import type { DebugOverlay } from "@/game/scene/overlays/debug";
import type { GridOverlay } from "@/game/scene/overlays/grid";
import type { PlayerRenderer } from "@/game/scene/player/renderer";
import type { InteractiveObjectData } from "@/game/types";
import {
  type CharacterSpriteLoader,
  initCharacterSpriteLoader,
} from "@/game/assets/character-sprite";
import { type CellData, findCellAtPosition } from "@/game/datacenter/cell";
import { computeMapScale, type MapData } from "@/game/datacenter/map";
import { loadInteractiveObjectsLang } from "@/game/lang/interactive-objects-lang";
import { loadNpcLang, type NpcLangData } from "@/game/lang/npc-lang";
import { Engine } from "@/game/render/engine";
import { RendererRegistry } from "@/game/render/renderer-registry";
import {
  type BattlefieldBootstrapContext,
  initEngineAndVello,
  initInteraction,
  initOverlays,
  initPickingAndAtlas,
  startSceneTicker,
  wireVelloLoaders,
} from "@/game/scene/battlefield/bootstrap";
import { BattlefieldPicking } from "@/game/scene/battlefield/picking";
import {
  BattlefieldWorldActors,
  type WorldActorData,
} from "@/game/scene/battlefield/world-actors";
import { BattlefieldZoom } from "@/game/scene/battlefield/zoom";
import { MapHandler } from "@/game/scene/map/handler";
import { Scene } from "@/game/scene/scene";
import { hideContextMenu } from "@/game/stores/context-menu-store";
import { fightActor } from "@/game/stores/fight-store";
import { FightUI } from "@/hud/fight/fight-ui";
import {
  setTacticalMode as setTacticalModeStore,
  tacticalModeStore,
} from "@/hud/fight/tactical-mode-store";
import { loadTheme } from "@/themes";

extensions.add(LayoutSystem);
TextureSource.defaultOptions.scaleMode = "linear";
TextureSource.defaultOptions.autoGenerateMipmaps = false;

// FightMode single source of truth is src/lib/machines/fightMachine.ts
// (state value) + src/lib/stores/fight-store.ts (type export).
import type { FightMode } from "@/game/stores/fight-store";
export type FightModeValue = FightMode;

export type { WorldActorData } from "@/game/scene/battlefield/world-actors";

export interface BattlefieldConfig {
  container: HTMLElement;
  backgroundColor?: number;
  preferWebGPU?: boolean;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  resizeDebounceMs?: number;
}

function projectFightMode(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "fighting" in value) {
    return "fighting";
  }
  return "none";
}

export class Battlefield {
  private engine: Engine;
  private app: Application | null = null;
  private mapContainer: Container | null = null;
  private atlasLoader: AtlasLoader | null = null;
  /**
   * Shared Vello renderer for spell .dofasset binaries. Populated by
   * `initPickingAndAtlas` via the bootstrap context; FightUI pulls it
   * out of the battlefield to hand to its SpellRenderer.
   */
  private spellVelloRenderer: SpellVelloRenderer | null = null;
  private mapHandler: MapHandler | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private pickingSystem: PickingSystem | null = null;
  private characterSpriteLoader: CharacterSpriteLoader;

  private fightUI: FightUI | null = null;
  private fightActorUnsubscribe: (() => void) | null = null;
  private tacticalUnsubscribe: (() => void) | null = null;
  private lastFightMode: string = "none";
  private tacticalMode = false;

  private currentMapData: MapData | null = null;
  private cellDataMap: Map<number, CellData> = new Map();

  private transparencyMode = false;
  private interactiveGfxIds = new Set<number>();
  private interactiveObjectsData = new Map<number, InteractiveObjectData>();
  private npcLangData = new Map<number, NpcLangData>();

  private pathfinding: DofusPathfinding | null = null;

  private debugOverlay: DebugOverlay | null = null;
  private gridOverlay: GridOverlay | null = null;

  /** Blur-out old map → blur-in new map on map change. */
  private mapTransition: MapTransition | null = null;
  private adjacentMapCache: AdjacentMapCache | null = null;

  /** Capability-bucketed actor registry + single ticker entry point. */
  private scene: Scene = new Scene();
  private sceneTickerCallback: (() => void) | null = null;

  private rendererRegistry = new RendererRegistry();

  private onCellClickCallback?: (cellId: number) => void;
  private onInteractiveUseCallback?: (cellId: number, skillId: number) => void;
  private onNpcTalkCallback?: (npcSpriteId: number) => void;
  private onCellHoverCallback?: (cellId: number | null) => void;
  private lastHoveredCellId: number | null = null;
  private onResizeStartCallback?: () => void;
  private onResizeEndCallback?: () => void;

  private readonly picking = new BattlefieldPicking({
    pickingSystem: () => this.pickingSystem,
    interactiveObjects: () => this.interactiveObjectsData,
    npcLang: () => this.npcLangData,
    worldActorRenderer: () => this.worldActors.getRenderer(),
    app: () => this.app,
    onCellPickThrough: (cellId) => this.onCellClickCallback?.(cellId),
    onInteractiveUse: (cellId, skillId) =>
      this.onInteractiveUseCallback?.(cellId, skillId),
    onNpcTalk: (npcSpriteId) => this.onNpcTalkCallback?.(npcSpriteId),
  });

  private readonly worldActors = new BattlefieldWorldActors({
    mapContainer: () => this.mapContainer,
    mapHandler: () => this.mapHandler,
    scene: () => this.scene,
    characterSpriteLoader: () => this.characterSpriteLoader,
    pickingSystem: () => this.pickingSystem,
    pathfinding: () => this.pathfinding,
    cellDataMap: () => this.cellDataMap,
    rendererRegistry: () => this.rendererRegistry,
    currentMapWidth: () => this.currentMapData?.width ?? 15,
    currentMapScale: () =>
      computeMapScale(
        this.currentMapData?.width ?? 15,
        this.currentMapData?.height ?? 17
      ),
    transparencyEnabled: () => this.transparencyMode,
    applyTransparency: () => this.applyTransparencyMode(),
    registerPlayerForPicking: (
      id,
      renderer,
      monsterGroup,
      isCurrentPlayer,
      monsterGroupBonus,
      groupSpriteIds,
      npcTemplateId
    ) =>
      this.picking.registerPlayer(
        id,
        renderer,
        monsterGroup,
        isCurrentPlayer,
        monsterGroupBonus,
        groupSpriteIds,
        npcTemplateId
      ),
    unregisterPlayerFromPicking: (id) => this.picking.unregisterPlayer(id),
    markPickingDirty: () => this.pickingSystem?.markDirty(),
  });

  private readonly zoom = new BattlefieldZoom({
    mapHandler: () => this.mapHandler,
    mapContainer: () => this.mapContainer,
    atlasLoader: () => this.atlasLoader,
    currentMapData: () => this.currentMapData,
    getViewport: () => this.getViewport(),
    onBeforeRebuild: () => {
      this.picking.clearTiles();
      this.debugOverlay?.clear();
    },
    onAfterRender: (z) =>
      this.notifyResize(
        z,
        this.app?.screen.width ?? 0,
        this.app?.screen.height ?? 0
      ),
  });

  constructor(config: BattlefieldConfig) {
    this.onResizeStartCallback = config.onResizeStart;
    this.onResizeEndCallback = config.onResizeEnd;

    this.characterSpriteLoader = initCharacterSpriteLoader();

    this.engine = new Engine({
      container: config.container,
      antialias: true,
      backgroundColor: config.backgroundColor ?? 0x000000,
      preferWebGPU: config.preferWebGPU ?? true,
      resizeDebounceMs: config.resizeDebounceMs ?? 300,
      onResize: (width, height) => this.handleCanvasResize(width, height),
      onResizeStart: () => this.handleResizeStart(),
      onResizeEnd: (width, height) => this.handleResizeEnd(width, height),
    });
  }

  private handleCanvasResize(width: number, height: number): void {
    if (this.pickingSystem) {
      this.pickingSystem.initializeTexture(width, height);
      this.pickingSystem.markDirty();
    }

    if (this.interactionHandler) {
      this.interactionHandler.setBaseZoom(this.engine.getBaseZoom());
    }

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    this.notifyResize(zoom, width, height);
  }

  private notifyResize(zoom: number, screenW: number, screenH: number): void {
    this.rendererRegistry.notifyResize({
      zoom,
      baseZoom: this.engine.getBaseZoom(),
      screenWidth: screenW,
      screenHeight: screenH,
    });
  }

  private handleResizeStart(): void {
    if (this.onResizeStartCallback) {
      this.onResizeStartCallback();
    }
  }

  private async handleResizeEnd(
    _width: number,
    _height: number
  ): Promise<void> {
    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    await this.zoom.forceRender(zoom);
    this.onResizeEndCallback?.();
  }

  async init(): Promise<void> {
    await loadTheme("classic");

    const ctx = this as unknown as BattlefieldBootstrapContext;
    await initEngineAndVello(ctx);
    await this.loadInteractiveObjects();
    await this.loadNpcLang();
    initPickingAndAtlas(ctx);
    await wireVelloLoaders(ctx);
    initInteraction(ctx);
    initOverlays(ctx);
    startSceneTicker(ctx);

    // Drive fight overlay lifecycle off the XState fightActor. The actor
    // receives FIGHT_INIT / FIGHT_END from the gameserver via FightHandler;
    // we only react to mode transitions and pass the canvas in/out of
    // fight-overlay state.
    this.fightActorUnsubscribe = fightActor.subscribe((snap) => {
      const mode = projectFightMode(snap.value);
      if (mode !== this.lastFightMode) {
        const previous = this.lastFightMode;
        this.lastFightMode = mode;
        if (
          mode === "placement" ||
          mode === "fighting" ||
          mode === "spectating"
        ) {
          this.enterFightMode(mode);
        } else {
          this.exitFightMode();
        }
        // Auto-enable the tactical grid lines the moment combat actually
        // starts (placement → fighting, or spectator drop-in). The
        // original client shows the grid by default during combat;
        // matching that behaviour avoids forcing the player to click the
        // tactical toggle on every fight. We only force-on at the edge:
        // if the user disables it mid-fight it stays off.
        if (
          (mode === "fighting" || mode === "spectating") &&
          previous !== "fighting" &&
          previous !== "spectating"
        ) {
          this.gridOverlay?.toggle(true);
        }
      }

      // Active-turn ring: redraw the current-turn fighter's ground
      // circle in the "glow" variant whenever the server shifts the
      // turn baton. Only meaningful once we're actually in combat —
      // context.currentTurnSpriteId is meaningful mid-fight, but the
      // ring layer is hidden during placement anyway.
      let turnId: number | null = null;
      if (mode === "fighting" && snap.context.currentTurnSpriteId) {
        const parsed = Number(snap.context.currentTurnSpriteId);
        turnId = Number.isFinite(parsed) ? parsed : null;
      }
      this.worldActors.getRenderer()?.setActiveTurnPlayer(turnId);
    }).unsubscribe;

    this.tacticalUnsubscribe = tacticalModeStore.subscribe(() => {
      // setTacticalMode is async (it re-renders the whole map); the store
      // change is the "intent" — we fire-and-forget and let the internal
      // tacticalMode guard dedupe repeated calls.
      void this.setTacticalMode(tacticalModeStore.getSnapshot().tactical);
    });
  }

  /**
   * Lazily create FightUI and bring up cell highlight / damage / spell
   * overlays on top of the existing world rendering. Idempotent.
   *
   * Team-colored ground rings are NOT enabled here — they turn on only
   * when the active state flips to "fighting" (below). During
   * placement the original client shows unadorned sprites; the rings
   * appear the moment combat actually starts.
   */
  enterFightMode(mode: string): void {
    // Circles appear once combat actually starts; during placement we
    // show the unadorned sprites like the original client. Spectators
    // always drop into an in-progress fight, so they keep the rings.
    this.worldActors
      .getRenderer()
      ?.setFightMode(mode === "fighting" || mode === "spectating");

    if (!this.fightUI) {
      this.fightUI = new FightUI(
        this.mapContainer,
        this.cellDataMap,
        this.pickingSystem,
        this.rendererRegistry,
        this.currentMapData
          ? {
              width: this.currentMapData.width,
              height: this.currentMapData.height,
            }
          : null,
        this.characterSpriteLoader,
        this.scene,
        // Spell FX get attached into objectLayer2 per-cell so sprites
        // on closer cells still occlude effects on farther ones, same
        // as VisualEffectHandler.as:35 in the original (effects live
        // inside Object2 at `cellNum*100+50±idx`).
        this.mapHandler?.getObjectLayer2() ?? null,
        this.spellVelloRenderer
      );
    }
    this.fightUI.enterFightMode(mode);

    // SpellRenderer + its asset loader are constructed inside
    // enterFightMode, so the rasterizer's resolution starts at its
    // default (1×). Sync it to the current zoom now — without this
    // the first spell cast renders at half the supersample density
    // of the rest of the canvas and looks blurry next to characters.
    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    this.fightUI.getSpellRenderer()?.getAssetLoader().setResolution(zoom);
  }

  exitFightMode(): void {
    const renderer = this.worldActors.getRenderer();
    renderer?.setActiveTurnPlayer(null);
    renderer?.setFightMode(false);
    this.fightUI?.exitFightMode();
    // Reset tactical mode so the next fight starts with normal terrain and
    // the HUD button reflects the actual render state. The store write
    // re-triggers setTacticalMode via the subscription.
    if (this.tacticalMode) {
      setTacticalModeStore(false);
    }
  }

  getFightUI(): FightUI | null {
    return this.fightUI;
  }

  getCurrentMapData(): MapData | null {
    return this.currentMapData;
  }

  /**
   * Returns whether the cell at `cellId` blocks line-of-sight (walls,
   * decorations, glass cells with `lineOfSight=false`). Used by spell
   * targeting to gate which cells the caster can see.
   */
  isCellLosBlocked(cellId: number): boolean {
    const cell = this.cellDataMap.get(cellId);
    if (!cell) {
      // Out-of-map cells are blocking by definition; the LoS walker
      // also short-circuits on out-of-bounds, so this is a safe
      // fallback when the map isn't loaded yet.
      return true;
    }
    return cell.lineOfSight === false;
  }

  /**
   * Toggle the tactical view: swap per-cell ground/layer1/layer2 IDs to the
   * extracted gfx.tactic sprites (walkable/blocked/LOS markers) and re-render
   * through the atlas pipeline. Mirrors the AS `MapHandler.tacticMode()`
   * semantics; falls back to a no-op when no map or map handler is ready.
   */
  async setTacticalMode(enabled: boolean): Promise<void> {
    if (
      this.tacticalMode === enabled ||
      !this.mapHandler ||
      !this.currentMapData ||
      !this.mapContainer
    ) {
      return;
    }
    this.tacticalMode = enabled;

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    const viewport = this.getViewport();

    if (enabled) {
      await this.mapHandler.enterTacticMode(
        this.currentMapData,
        this.mapContainer,
        zoom,
        viewport
      );
    } else {
      await this.mapHandler.exitTacticMode(
        this.currentMapData,
        this.mapContainer,
        zoom,
        viewport
      );
    }

    this.pickingSystem?.markDirty();
  }

  isTacticalMode(): boolean {
    return this.tacticalMode;
  }

  async loadManifest(): Promise<void> {
    if (!this.atlasLoader) {
      return;
    }

    this.mapHandler = new MapHandler({
      atlasLoader: this.atlasLoader,
      interactiveGfxIds: this.interactiveGfxIds,
      scene: this.scene,
      onSpriteCreated: (
        sprite,
        tileId,
        cellId,
        layer,
        rotation,
        flip,
        groundSlope
      ) => {
        // Only layer 2 carries elements — the interactive bit is
        // `layerObject2Interactive`, there is no layer-1 equivalent.
        if (layer === 2 && this.isInteractiveTile(tileId, cellId)) {
          this.picking.registerTile(sprite, tileId, cellId);
        }

        // Register sprite with debug overlay
        if (this.debugOverlay) {
          const type = layer === 0 ? "ground" : "objects";
          this.debugOverlay.registerSprite({
            sprite,
            tileId,
            cellId,
            layer,
            type,
            rotation,
            flip,
            groundSlope,
          });
        }
      },
    });
  }

  async loadMapFromData(
    mapData: MapData,
    direction?: TransitionDirection
  ): Promise<void> {
    if (
      !this.mapContainer ||
      !this.mapHandler ||
      !this.atlasLoader ||
      !this.app
    ) {
      return;
    }

    // Non-blocking snapshot of the old map; new tiles render behind it.
    this.mapTransition?.startTransition(direction);

    this.currentMapData = mapData;
    this.cellDataMap.clear();

    for (const cell of mapData.cells) {
      this.cellDataMap.set(cell.id, cell);
    }

    // The tile layers bake `computeMapScale` into every sprite position,
    // which recentres any map that is not 15x17 (a fifth of the world).
    // Actors are drawn from raw cell positions, so they need the same
    // transform or they drift off the terrain — an 11x13 house interior
    // shifts its floor by (106, 54), and the character stays behind on
    // the wall. Re-applied here rather than at construction because
    // `prepareWorldActors()` runs before `currentMapData` is assigned.
    this.worldActors.applyMapTransform();

    this.mapContainer.x = 0;
    this.mapContainer.y = 0;

    this.picking.clearTiles();
    this.debugOverlay?.clear();
    this.gridOverlay?.clear();

    // Drop any stale tactic state from the prior map so the fresh render
    // uses the normal ground_/objects_ prefixes. Re-applied below if the
    // player was in tactic mode before the transition.
    this.mapHandler.clearTacticState();

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    this.atlasLoader.setZoom(zoom);
    this.characterSpriteLoader.setZoom(zoom);
    // Spell asset loader sits inside FightUI's SpellRenderer, which
    // doesn't exist until enterFightMode runs. Push the current zoom
    // directly through the FightUI handle when present so the spell
    // strip rasterizer matches character density. No registry fan-out
    // — that would re-fire onResize on every other renderer mid-
    // renderMap and disturb placement-cell / preview state.
    const spellLoader = this.fightUI?.getSpellRenderer()?.getAssetLoader();
    spellLoader?.setResolution(zoom);
    await this.mapHandler.renderMap(
      mapData,
      this.mapContainer,
      zoom,
      this.getViewport()
    );

    this.positionGridBelowObject2();

    this.gridOverlay?.setMapData(
      mapData.cells,
      mapData.width,
      mapData.height,
      mapData.triggerCellIds ?? []
    );
    this.debugOverlay?.setMapData(mapData.cells, mapData.width, mapData.height);

    // Tactic mode survives map changes: once the fresh terrain is drawn,
    // re-apply the tactic rewrite so a mid-fight teleport keeps the player
    // in the tactic view they toggled into.
    if (this.tacticalMode) {
      await this.mapHandler.enterTacticMode(
        mapData,
        this.mapContainer,
        zoom,
        this.getViewport()
      );
    }
    // Map is ready — world actor container gets re-created on MAP_ACTORS.
  }

  /**
   * Slot the grid overlay between Object1 and Object2 layers.
   * Mirrors ExternalContainer.as original depths: Ground=200, Object1=300,
   * Grid=400, Object2=800 — grid sits above walkable tiles, below foreground.
   */
  private positionGridBelowObject2(): void {
    if (!this.gridOverlay || !this.mapContainer) {
      return;
    }

    const gridContainer = this.gridOverlay.getContainer();

    // mapContainer.sortableChildren is on and every root layer
    // (including the grid) has an explicit zIndex, so order is
    // determined by those indices. We only need to make sure the
    // grid container IS a child of mapContainer.
    if (!this.mapContainer.children.includes(gridContainer)) {
      this.mapContainer.addChild(gridContainer);
    }
  }

  /**
   * Prepare world actors for the new map.
   * Destroys old actor container + renderer and creates fresh ones.
   * Called by GameClient right before adding MAP_ACTORS.
   */
  prepareWorldActors(): void {
    // `reset()` destroys the renderer and every sprite it owns, so the
    // picking entries for those actors are dead the moment it returns.
    // Left in place they keep answering clicks — and since ids are
    // handed out per pickable, a tile of the new map inherits the name
    // and menu of an actor from the old one.
    this.picking.clearPlayers();
    this.worldActors.reset();
  }

  /**
   * Reveal the map container after map + actors are ready.
   * Called by GameClient after MAP_ACTORS have been added.
   * Crossfades old snapshot out while unblurring the new map.
   */
  async revealMap(): Promise<void> {
    await this.mapTransition?.reveal();
  }

  /**
   * Load adjacent map data into the cache for background prefetching.
   */
  loadAdjacentMaps(
    maps: Array<{ mapId: number; dx: number; dy: number; mapData: MapData }>
  ): void {
    this.adjacentMapCache?.loadAdjacentMaps(maps);
  }

  /**
   * Get the transition direction for a target map from the adjacent cache.
   */
  getAdjacentDirection(mapId: number): TransitionDirection | null {
    return this.adjacentMapCache?.getDirection(mapId) ?? null;
  }

  /** Set the player character ID (used for tracking). */
  setDebugPlayerId(_id: number): void {
    // Reserved for future use
  }

  setPathfinding(pathfinding: DofusPathfinding | null): void {
    this.pathfinding = pathfinding;
  }

  // ============================================================================
  // World Actor Methods (Roleplay Mode)
  // ============================================================================

  addWorldActor(data: WorldActorData): Promise<void> {
    return this.worldActors.add(data);
  }

  /**
   * Public handle on the world-actor PlayerRenderer — the renderer that
   * actually holds every on-screen fighter during combat. Callers who
   * need per-fighter cell lookups (e.g. resolving the caster cell for a
   * spell animation) should go through this rather than the empty
   * FightUI PlayerRenderer.
   */
  getWorldActorRenderer() {
    return this.worldActors.getRenderer();
  }

  /** Look changes on equip/unequip re-render the actor with new accessories. */
  updateActorLook(id: number, look: string): void {
    this.worldActors.updateLook(id, look);
  }

  removeWorldActor(id: number): void {
    this.worldActors.remove(id);
  }

  /**
   * Cut a walking actor's path short at the cell it is entering.
   * Returns that cell, or `null` when the actor was not walking.
   */
  interruptWorldActor(id: number): number | null {
    return this.worldActors.interrupt(id);
  }

  moveWorldActor(id: number, path: number[]): Promise<void> {
    return this.worldActors.move(id, path);
  }

  clearWorldActors(): void {
    this.worldActors.clear();
  }

  private async loadNpcLang(): Promise<void> {
    this.npcLangData = await loadNpcLang();
  }

  private async loadInteractiveObjects(): Promise<void> {
    this.interactiveObjectsData = await loadInteractiveObjectsLang();

    for (const gfxId of this.interactiveObjectsData.keys()) {
      this.interactiveGfxIds.add(gfxId);
    }
  }

  /**
   * Whether a sprite is an element the player can act on.
   *
   * The gfx id alone does not answer that: the same sprite is decoration on
   * one cell and a usable element on the next. Canonical 1.29 reads the cell's
   * own `layerObject2Interactive` bit (`MapHandler.as:359`), which the server
   * now ships in `MapCell`. The gfx lookup only decides *what* the element is
   * once the bit says there is one.
   */
  private isInteractiveTile(tileId: number, cellId: number): boolean {
    if (!this.cellDataMap.get(cellId)?.layerObject2Interactive) {
      return false;
    }

    return this.interactiveGfxIds.has(tileId);
  }

  /**
   * Get the current viewport bounds in map coordinates for culling
   */
  private getViewport(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    if (!this.mapContainer || !this.app) {
      return null;
    }

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    const containerX = this.mapContainer.x;
    const containerY = this.mapContainer.y;
    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;

    // Convert screen bounds to map coordinates
    return {
      x: -containerX / zoom,
      y: -containerY / zoom,
      width: screenWidth / zoom,
      height: screenHeight / zoom,
    };
  }

  // Called via BattlefieldBootstrapContext from the interaction handler.
  handleGroundClick(mapX: number, mapY: number): void {
    if (!this.currentMapData) {
      return;
    }

    const mapScale = computeMapScale(
      this.currentMapData.width,
      this.currentMapData.height
    );
    const cell = findCellAtPosition(
      mapX,
      mapY,
      this.currentMapData.cells,
      this.currentMapData.width,
      mapScale
    );

    if (cell?.walkable) {
      this.onCellClickCallback?.(cell.id);
    }
  }

  setOnInteractiveUse(
    callback: (cellId: number, skillId: number) => void
  ): void {
    this.onInteractiveUseCallback = callback;
  }

  setOnNpcTalk(callback: (npcSpriteId: number) => void): void {
    this.onNpcTalkCallback = callback;
  }

  setOnCellClick(callback: (cellId: number) => void): void {
    this.onCellClickCallback = callback;
  }

  // Called via BattlefieldBootstrapContext. Resolves the cell under the
  // cursor once per pointermove tick and fans out to the registered
  // hover callback only when the cell ID actually changes — subscribers
  // don't want N calls per second for the same cell.
  handleGroundHover(mapX: number, mapY: number): void {
    if (!this.currentMapData) {
      return;
    }
    const mapScale = computeMapScale(
      this.currentMapData.width,
      this.currentMapData.height
    );
    const cell = findCellAtPosition(
      mapX,
      mapY,
      this.currentMapData.cells,
      this.currentMapData.width,
      mapScale
    );
    const cellId = cell?.walkable ? cell.id : null;
    if (cellId === this.lastHoveredCellId) {
      return;
    }
    this.lastHoveredCellId = cellId;
    // Canonical hover hit area for fighters is the FULL diamond cell
    // they stand on (`%1D%11%1C.as:162` attaches `onRollOver` to each
    // `InteractionCell` MovieClip, not to the fighter sprite). Drive
    // the picking system's via-cell fighter hover off the same event
    // so a sprite-pixel miss next to the fighter still triggers the
    // hover effects — but ONLY in combat. Outside combat the world
    // map's regular sprite-pixel hover is canonical (the cell-level
    // InteractionCell only existed in fight scenes), and firing
    // `setHoverByCell` from the world map double-triggers the same
    // sprite hover from a coarser hitbox, breaking the hover feel
    // for nearby NPCs / interactive objects.
    const fightActive =
      this.lastFightMode === "placement" ||
      this.lastFightMode === "fighting" ||
      this.lastFightMode === "spectating";
    if (fightActive) {
      this.picking.setHoverByCell(cellId);
    } else {
      // Make sure no stale via-cell hover lingers from the last fight.
      this.picking.setHoverByCell(null);
    }
    this.onCellHoverCallback?.(cellId);
  }

  setOnCellHover(callback: (cellId: number | null) => void): void {
    this.onCellHoverCallback = callback;
  }

  /**
   * Hover-on-self callback. Fires `true` when the user rolls over their
   * own avatar in fight mode and `false` on roll-out. Mirrors canonical
   * Sprite._rollOver / _rollOut so consumers (e.g. MP-range overlay)
   * only paint while the user is actually pointing at their fighter.
   */
  setOnSelfHover(callback: (hovered: boolean) => void): void {
    this.picking.setOnSelfHover(callback);
  }

  getApp(): Application | null {
    return this.app;
  }

  getBaseZoom(): number {
    return this.engine.getBaseZoom();
  }

  handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  destroy(): void {
    // Clean up map transition and adjacent cache
    this.mapTransition?.destroy();
    this.mapTransition = null;
    this.adjacentMapCache?.destroy();
    this.adjacentMapCache = null;

    this.zoom.destroy();
    hideContextMenu();

    if (this.sceneTickerCallback) {
      Ticker.shared.remove(this.sceneTickerCallback);
      this.sceneTickerCallback = null;
    }

    this.scene.clear();

    this.fightActorUnsubscribe?.();
    this.fightActorUnsubscribe = null;
    this.tacticalUnsubscribe?.();
    this.tacticalUnsubscribe = null;

    this.fightUI?.destroy();
    this.fightUI = null;

    this.rendererRegistry.clear();

    // World actor container is objectLayer2 owned by mapHandler; we just drop the renderer.
    this.worldActors.destroy();

    this.debugOverlay?.destroy();
    this.debugOverlay = null;
    this.gridOverlay?.destroy();
    this.gridOverlay = null;

    this.interactionHandler?.destroy();
    this.pickingSystem?.destroy();
    this.atlasLoader?.clearCache();
    this.mapHandler?.clearCache();
    this.engine.destroy();
  }

  toggleDebug(): boolean {
    return this.debugOverlay?.toggle() ?? false;
  }

  toggleGridOverlay(): boolean {
    return this.gridOverlay?.toggle() ?? false;
  }

  toggleTransparency(): boolean {
    this.transparencyMode = !this.transparencyMode;
    this.applyTransparencyMode();
    return this.transparencyMode;
  }

  private applyTransparencyMode(): void {
    // Ghost view boosts player zIndex above Object2 + reduces alpha; off → cell-depth interleave.
    this.worldActors.getRenderer()?.setGhostView(this.transparencyMode);
  }

  // Only playSpell + getPlayerRenderer are reachable externally; the rest of the
  // fight API lives on FightUI directly.

  async playSpell(config: SpellAnimationConfig): Promise<void> {
    await this.fightUI?.playSpell(config);
  }

  getPlayerRenderer(): PlayerRenderer | null {
    return this.fightUI?.getPlayerRenderer() ?? null;
  }
}
