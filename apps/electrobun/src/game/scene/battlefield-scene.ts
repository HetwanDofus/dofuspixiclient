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
import type { SpellAnimationConfig } from "@/game/scene/fight/spell-view";
import type {
  MapTransition,
  TransitionDirection,
} from "@/game/scene/map/transition";
import type { DebugOverlay } from "@/game/scene/overlays/debug";
import type { GridOverlay } from "@/game/scene/overlays/grid";
import type { PlayerRenderer } from "@/game/scene/player/renderer";
import type { InteractiveObjectData } from "@/game/types";
import type { FightUI } from "@/hud/fight/fight-ui";
import {
  type CharacterSpriteLoader,
  initCharacterSpriteLoader,
} from "@/game/assets/character-sprite";
import { type CellData, findCellAtPosition } from "@/game/datacenter/cell";
import { computeMapScale, type MapData } from "@/game/datacenter/map";
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
import { loadTheme } from "@/themes";
import { createLogger } from "@/utils/logger";

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

const log = createLogger("Battlefield");

export class Battlefield {
  private engine: Engine;
  private app: Application | null = null;
  private mapContainer: Container | null = null;
  private atlasLoader: AtlasLoader | null = null;
  private mapHandler: MapHandler | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private pickingSystem: PickingSystem | null = null;
  private characterSpriteLoader: CharacterSpriteLoader;

  private fightUI: FightUI | null = null;

  private currentMapData: MapData | null = null;
  private cellDataMap: Map<number, CellData> = new Map();

  private transparencyMode = false;
  private interactiveGfxIds = new Set<number>();
  private interactiveObjectsData = new Map<number, InteractiveObjectData>();

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
  private onResizeStartCallback?: () => void;
  private onResizeEndCallback?: () => void;

  private readonly picking = new BattlefieldPicking({
    pickingSystem: () => this.pickingSystem,
    interactiveObjects: () => this.interactiveObjectsData,
    worldActorRenderer: () => this.worldActors.getRenderer(),
    app: () => this.app,
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
    transparencyEnabled: () => this.transparencyMode,
    applyTransparency: () => this.applyTransparencyMode(),
    registerPlayerForPicking: (id, renderer) =>
      this.picking.registerPlayer(id, renderer),
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
    initPickingAndAtlas(ctx);
    await wireVelloLoaders(ctx);
    initInteraction(ctx);
    initOverlays(ctx);
    startSceneTicker(ctx);
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
        if (layer > 0 && this.isInteractiveTile(tileId)) {
          this.picking.registerTile(sprite, tileId);
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

    this.mapContainer.x = 0;
    this.mapContainer.y = 0;

    this.picking.clearTiles();
    this.debugOverlay?.clear();
    this.gridOverlay?.clear();

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    this.atlasLoader.setZoom(zoom);
    this.characterSpriteLoader.setZoom(zoom);
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
    // Map is ready — world actor container gets re-created on MAP_ACTORS.
  }

  /**
   * Slot the grid overlay between Object1 and Object2 layers.
   * Mirrors ExternalContainer.as original depths: Ground=200, Object1=300,
   * Grid=400, Object2=800 — grid sits above walkable tiles, below foreground.
   */
  private positionGridBelowObject2(): void {
    if (!this.gridOverlay || !this.mapHandler || !this.mapContainer) {
      return;
    }

    const gridContainer = this.gridOverlay.getContainer();
    const obj2 = this.mapHandler.getObjectLayer2();

    if (this.mapContainer.children.includes(gridContainer)) {
      this.mapContainer.removeChild(gridContainer);
    }

    if (this.mapContainer.children.includes(obj2)) {
      const obj2Index = this.mapContainer.getChildIndex(obj2);
      this.mapContainer.addChildAt(gridContainer, obj2Index);
    }
  }

  /**
   * Prepare world actors for the new map.
   * Destroys old actor container + renderer and creates fresh ones.
   * Called by GameClient right before adding MAP_ACTORS.
   */
  prepareWorldActors(): void {
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

  /** Look changes on equip/unequip re-render the actor with new accessories. */
  updateActorLook(id: number, look: string): void {
    this.worldActors.updateLook(id, look);
  }

  removeWorldActor(id: number): void {
    this.worldActors.remove(id);
  }

  moveWorldActor(id: number, path: number[]): Promise<void> {
    return this.worldActors.move(id, path);
  }

  clearWorldActors(): void {
    this.worldActors.clear();
  }

  private async loadInteractiveObjects(): Promise<void> {
    try {
      const response = await fetch("/assets/data/interactive-objects.json");
      const data = await response.json();

      const interactiveObjects = data.interactiveObjects || {};

      for (const obj of Object.values(
        interactiveObjects
      ) as InteractiveObjectData[]) {
        if (obj.gfxIds && Array.isArray(obj.gfxIds)) {
          for (const gfxId of obj.gfxIds) {
            this.interactiveGfxIds.add(gfxId);
            this.interactiveObjectsData.set(gfxId, obj);
          }
        }
      }
    } catch (error) {
      log.error("Failed to load interactive objects:", error);
    }
  }

  private isInteractiveTile(tileId: number): boolean {
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

  setOnCellClick(callback: (cellId: number) => void): void {
    this.onCellClickCallback = callback;
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
