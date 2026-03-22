import { LayoutSystem } from "@pixi/layout";
import {
  type Application,
  Container,
  extensions,
  type Sprite,
  TextureSource,
  Ticker,
} from "pixi.js";

import type { InteractiveObjectData, PickResult, RenderStats } from "@/types";
import { ZaapContextMenu } from "@/ank/gapi/controls";
import { DISPLAY_HEIGHT } from "@/constants/battlefield";
import { type GameWorld, getGameWorld } from "@/ecs/world";

import { Banner } from "@/hud/banner";
import { ConquestPanel } from "@/hud/conquest";
import { initTooltipBounds } from "@/hud/core/tooltip";
import { FriendsPanel } from "@/hud/friends";
import { GuildPanel } from "@/hud/guild";
import { InventoryPanel } from "@/hud/inventory";
import { MountPanel } from "@/hud/mount";
import { QuestsPanel } from "@/hud/quests";
import { SpellsPanel } from "@/hud/spells";
import { StatsPanel } from "@/hud/stats";
import { WorldMapPanel } from "@/hud/worldmap";
import { AtlasLoader } from "@/render/atlas-loader";
import { Engine } from "@/render/engine";
import { PickingSystem } from "@/render/picking-system";
import { RendererRegistry } from "@/render/renderer-registry";
import { loadTheme } from "@/themes";
import { pushInteractionEvent } from "@/ecs/systems/interaction-dispatch-system";

import {
  CellHighlighter,
  HighlightType,
  type HighlightTypeValue,
} from "./cell-highlighter";
import { getCharacterSpriteLoader } from "./character-sprite";
import {
  type DamageDisplayConfig,
  DamageRenderer,
  DamageType,
} from "./damage-renderer";
import { type CellData, findCellAtPosition } from "./datacenter/cell";
import { computeMapScale, loadMapData, type MapData } from "./datacenter/map";
import { DebugOverlay } from "./debug-overlay";
import {
  type FighterAnimationValue,
  FighterRenderer,
  type FighterSpriteData,
} from "./fighter-renderer";
import { GridOverlay } from "./grid-overlay";
import { InteractionHandler } from "./interaction-handler";
import { MapHandler } from "./map-handler";
import { MapTransition } from "./map-transition";
import { type SpellAnimationConfig, SpellRenderer } from "./spell-renderer";
import { StressTest } from "./stress-test";

extensions.add(LayoutSystem);
TextureSource.defaultOptions.scaleMode = "linear";
TextureSource.defaultOptions.autoGenerateMipmaps = false;

/**
 * Combat mode state.
 */
export const CombatMode = {
  NONE: "none",
  PLACEMENT: "placement",
  FIGHTING: "fighting",
  SPECTATING: "spectating",
} as const;

export type CombatModeValue = (typeof CombatMode)[keyof typeof CombatMode];

export interface WorldActorData {
  id: number;
  name: string;
  cellId: number;
  direction: number;
  look: string;
  isCurrentPlayer: boolean;
}

export interface BattlefieldConfig {
  container: HTMLElement;
  backgroundColor?: number;
  preferWebGPU?: boolean;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  resizeDebounceMs?: number;
}

export class Battlefield {
  private engine: Engine;
  private app: Application | null = null;
  private mapContainer: Container | null = null;
  private atlasLoader: AtlasLoader | null = null;
  private mapHandler: MapHandler | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private pickingSystem: PickingSystem | null = null;
  private banner: Banner | null = null;
  private statsPanel: StatsPanel | null = null;
  private spellsPanel: SpellsPanel | null = null;
  private inventoryPanel: InventoryPanel | null = null;
  private questsPanel: QuestsPanel | null = null;
  private friendsPanel: FriendsPanel | null = null;
  private guildPanel: GuildPanel | null = null;
  private mountPanel: MountPanel | null = null;
  private conquestPanel: ConquestPanel | null = null;
  private worldMapPanel: WorldMapPanel | null = null;

  private currentMapData: MapData | null = null;
  private currentMapId: number | null = null;
  private cellDataMap: Map<number, CellData> = new Map();

  private interactiveGfxIds = new Set<number>();
  private interactiveObjectsData = new Map<number, InteractiveObjectData>();
  private pickableIdToGfxId = new Map<number, number>();
  private nextPickableId = 1;
  private currentContextMenu: ZaapContextMenu | null = null;

  // Combat mode state
  private combatMode: CombatModeValue = CombatMode.NONE;
  private combatContainer: Container | null = null;
  private cellHighlighter: CellHighlighter | null = null;
  private fighterRenderer: FighterRenderer | null = null;
  private damageRenderer: DamageRenderer | null = null;
  private spellRenderer: SpellRenderer | null = null;

  // World actors (roleplay mode)
  private worldActorContainer: Container | null = null;
  private worldActorRenderer: FighterRenderer | null = null;

  // Debug overlay
  private debugOverlay: DebugOverlay | null = null;
  private gridOverlay: GridOverlay | null = null;
  private stressTest: StressTest | null = null;

  // Map transition: blur out old map → blur in new map
  private mapTransition: MapTransition | null = null;

  // Ground click callback
  // ECS
  private gameWorld: GameWorld;
  private ecsTickerCallback: (() => void) | null = null;

  // Renderer registry
  private rendererRegistry = new RendererRegistry();

  // Interactive entity tracking (temporary bridge for fighters)
  private interactiveCallbacks = new Map<number, {
    onHover: ((hovered: boolean) => void) | null;
    onClick: (() => void) | null;
  }>();
  private fighterIdToPickableId = new Map<number, number>();
  private lastHoveredPickableId: number | undefined;

  private onCellClickCallback?: (cellId: number) => void;
  private onMinimapTeleportCallback?: (mapId: number) => void;
  private onBoostStatCallback?: (statId: number) => void;

  private onResizeStartCallback?: () => void;
  private onResizeEndCallback?: () => void;

  // Render state management
  private isRendering = false;
  private pendingZoom: number | null = null;
  private zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: BattlefieldConfig) {
    this.onResizeStartCallback = config.onResizeStart;
    this.onResizeEndCallback = config.onResizeEnd;

    this.gameWorld = getGameWorld();

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
    this.updatePanelPositions();
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
    if (
      !this.currentMapData ||
      !this.mapHandler ||
      !this.mapContainer ||
      !this.atlasLoader
    ) {
      if (this.onResizeEndCallback) {
        this.onResizeEndCallback();
      }
      return;
    }

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();

    console.log("[Battlefield] handleResizeEnd", { zoom });

    try {
      // Opt #7: Try texture-swap first
      if (this.mapHandler.hasSpriteRefs()) {
        this.mapContainer.scale.set(zoom);
        const success = await this.mapHandler.updateTexturesForZoom(zoom);
        if (success) {
          if (this.onResizeEndCallback) {
            this.onResizeEndCallback();
          }
          return;
        }
      }

      // Full rebuild fallback
      this.atlasLoader.setZoom(zoom);

      console.log("[Battlefield] Re-rendering map at zoom:", zoom);

      this.clearPickableObjects();
      this.debugOverlay?.clear();
      this.mapHandler.clearCache();

      await this.mapHandler.renderMap(
        this.currentMapData,
        this.mapContainer,
        zoom,
        this.getViewport()
      );
    } catch (error) {
      console.error("[Battlefield] Resize render error:", error);
    }

    if (this.onResizeEndCallback) {
      this.onResizeEndCallback();
    }
  }

  async init(): Promise<void> {
    await loadTheme("classic");
    await this.engine.init();
    this.app = this.engine.getApp();

    this.mapContainer = new Container();
    this.app.stage.addChild(this.mapContainer);

    this.mapTransition = new MapTransition(this.app, this.mapContainer);

    await this.loadInteractiveObjects();

    const canvas = this.engine.getCanvas();

    if (!canvas) {
      throw new Error("Canvas not created");
    }

    this.pickingSystem = new PickingSystem(this.app.renderer, 16);
    this.pickingSystem.initializeTexture(
      this.app.screen.width,
      this.app.screen.height
    );

    this.atlasLoader = new AtlasLoader(
      this.app.renderer,
      "/assets/spritesheets"
    );

    const baseZoom = this.engine.getBaseZoom();
    this.banner = new Banner(this.app, DISPLAY_HEIGHT);
    this.banner.init(this.app.screen.width, baseZoom);
    this.banner.setOnMinimapTeleport((mapId) => {
      this.onMinimapTeleportCallback?.(mapId);
    });
    // Wire banner button toggles with mutual exclusion
    this.banner.setOnStatsToggle(() => this.togglePanel('stats'));
    this.banner.setOnSpellsToggle(() => this.togglePanel('spells'));
    this.banner.setOnInventoryToggle(() => this.togglePanel('inventory'));
    this.banner.setOnQuestsToggle(() => this.togglePanel('quests'));
    this.banner.setOnMapToggle(() => this.toggleWorldMap());
    this.banner.setOnFriendsToggle(() => this.togglePanel('friends'));
    this.banner.setOnGuildToggle(() => this.togglePanel('guild'));
    this.banner.setOnMountToggle(() => this.togglePanel('mount'));
    this.banner.setOnConquestToggle(() => this.togglePanel('conquest'));

    // World map panel — covers the game render area (below banner z-order)
    this.worldMapPanel = new WorldMapPanel(this.app);
    const gameAreaH = Math.floor(DISPLAY_HEIGHT * baseZoom);
    this.worldMapPanel.setArea(this.app.screen.width, gameAreaH);
    this.worldMapPanel.setOnTeleport((mapId) => {
      this.onMinimapTeleportCallback?.(mapId);
    });
    this.worldMapPanel.setOnClose(() => {
      if (this.interactionHandler) {
        this.interactionHandler.enabled = true;
      }
    });
    this.app.stage.addChild(this.worldMapPanel.container);

    // Banner — always on top of world map
    this.app.stage.addChild(this.banner.getGraphics());

    // Create all panels — anchored above the banner
    this.statsPanel = new StatsPanel(baseZoom);
    this.statsPanel.setOnBoostStat((statId) => {
      this.onBoostStatCallback?.(statId);
    });
    this.statsPanel.setOnClose(() => this.banner?.setStatsPressed(false));
    this.app.stage.addChild(this.statsPanel.container);

    this.spellsPanel = new SpellsPanel(baseZoom);
    this.spellsPanel.setOnClose(() => this.banner?.setSpellsPressed(false));
    this.app.stage.addChild(this.spellsPanel.container);

    this.inventoryPanel = new InventoryPanel(baseZoom);
    this.inventoryPanel.setOnClose(() => this.banner?.setInventoryPressed(false));
    this.app.stage.addChild(this.inventoryPanel.container);

    this.questsPanel = new QuestsPanel(baseZoom);
    this.questsPanel.setOnClose(() => this.banner?.setQuestsPressed(false));
    this.app.stage.addChild(this.questsPanel.container);

    this.friendsPanel = new FriendsPanel(baseZoom);
    this.friendsPanel.setOnClose(() => this.banner?.setFriendsPressed(false));
    this.app.stage.addChild(this.friendsPanel.container);

    this.guildPanel = new GuildPanel(baseZoom);
    this.guildPanel.setOnClose(() => this.banner?.setGuildPressed(false));
    this.app.stage.addChild(this.guildPanel.container);

    this.mountPanel = new MountPanel(baseZoom);
    this.mountPanel.setOnClose(() => this.banner?.setMountPressed(false));
    this.app.stage.addChild(this.mountPanel.container);

    this.conquestPanel = new ConquestPanel(baseZoom);
    this.conquestPanel.setOnClose(() => this.banner?.setConquestPressed(false));
    this.app.stage.addChild(this.conquestPanel.container);

    this.updatePanelPositions();

    initTooltipBounds(this.app);

    this.app.stage.eventMode = "static";
    this.mapContainer.eventMode = "static";

    this.interactionHandler = new InteractionHandler({
      mapContainer: this.mapContainer,
      pickingSystem: this.pickingSystem,
      canvas,
      onZoomChange: (zoom, index) => this.handleZoomChange(zoom, index),
      onObjectClick: (result) => this.handleObjectClick(result),
      onObjectHover: (result) => this.handleObjectHover(result),
      onGroundClick: (mapX, mapY) => this.handleGroundClick(mapX, mapY),
    });
    this.interactionHandler.init();
    this.interactionHandler.setBaseZoom(this.engine.getBaseZoom());

    this.app.stage.on("pointerdown", (e) => {
      if (this.isPointOverUI(e.global.x, e.global.y)) return;
      this.interactionHandler?.handlePointerDown(e);
    });
    this.app.stage.on("pointermove", (e) => {
      if (this.isPointOverUI(e.global.x, e.global.y)) return;
      this.interactionHandler?.handlePointerMove(e);
    });
    this.app.stage.on("pointerup", () =>
      this.interactionHandler?.handlePointerUp()
    );
    this.app.stage.on("pointerupoutside", () =>
      this.interactionHandler?.handlePointerUp()
    );

    // Initialize debug overlay
    this.debugOverlay = new DebugOverlay(this.app.stage);
    this.debugOverlay.setMapContainer(this.mapContainer);
    this.debugOverlay.setScreenSize(
      this.app.screen.width,
      this.app.screen.height
    );

    // Initialize grid overlay (inside mapContainer so it pans/zooms with map)
    this.gridOverlay = new GridOverlay(this.mapContainer);

    // Initialize ECS world and wire to PixiJS Ticker
    await this.gameWorld.init();
    this.ecsTickerCallback = () => {
      this.gameWorld.execute();
    };

    Ticker.shared.add(this.ecsTickerCallback);

    // Register renderers
    this.rendererRegistry.register("banner", (e) => this.banner!.onResize(e));
    this.rendererRegistry.register("debug-overlay", (e) => this.debugOverlay!.onResize(e));
    this.rendererRegistry.register("grid-overlay", (e) => this.gridOverlay!.onResize(e));
    // Panels are rebuilt + repositioned together in updatePanelPositions()
  }

  /** Resolves when banner assets are fully loaded and drawn. */
  async waitForBannerLoaded(): Promise<void> {
    await this.banner?.whenLoaded();
  }

  /**
   * Get the ECS GameWorld for pushing commands.
   */
  getGameWorld(): GameWorld {
    return this.gameWorld;
  }

  async loadManifest(): Promise<void> {
    if (!this.atlasLoader) {
      return;
    }

    this.mapHandler = new MapHandler({
      atlasLoader: this.atlasLoader,
      interactiveGfxIds: this.interactiveGfxIds,
      onSpriteCreated: (sprite, tileId, cellId, layer) => {
        if (layer > 0 && this.isInteractiveTile(tileId)) {
          const pickableId = this.nextPickableId++;
          this.registerPickableObject(pickableId, sprite, tileId);
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
          });
        }
      },
    });
  }

  async loadMap(mapId: number): Promise<void> {
    if (!this.mapContainer || !this.mapHandler || !this.atlasLoader) {
      return;
    }

    const mapData = await loadMapData(mapId);
    this.currentMapData = mapData;

    this.cellDataMap.clear();
    for (const cell of mapData.cells) {
      this.cellDataMap.set(cell.id, cell);
    }

    this.mapContainer.x = 0;
    this.mapContainer.y = 0;

    this.clearPickableObjects();
    this.debugOverlay?.clear();

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    // Set zoom on loaders for crisp SVG rasterization at current zoom level
    this.atlasLoader.setZoom(zoom);
    getCharacterSpriteLoader().setZoom(zoom);
    await this.mapHandler.renderMap(
      mapData,
      this.mapContainer,
      zoom,
      this.getViewport()
    );
  }

  /**
   * Load a map from already-parsed MapData (e.g., from server MAP_DATA).
   */
  updateMinimapPosition(mapId: number): void {
    this.currentMapId = mapId;
    this.banner?.updateMinimapPosition(mapId);
  }

  async loadMapFromData(mapData: MapData): Promise<void> {
    if (
      !this.mapContainer ||
      !this.mapHandler ||
      !this.atlasLoader ||
      !this.app
    ) {
      return;
    }

    // Capture snapshot of old map — non-blocking, tiles render behind it.
    this.mapTransition?.startTransition();

    this.currentMapData = mapData;

    this.cellDataMap.clear();
    for (const cell of mapData.cells) {
      this.cellDataMap.set(cell.id, cell);
    }

    this.mapContainer.x = 0;
    this.mapContainer.y = 0;

    this.clearPickableObjects();
    this.debugOverlay?.clear();
    this.gridOverlay?.clear();

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    this.atlasLoader.setZoom(zoom);
    getCharacterSpriteLoader().setZoom(zoom);
    await this.mapHandler.renderMap(
      mapData,
      this.mapContainer,
      zoom,
      this.getViewport()
    );

    // Update grid overlay with new map data
    this.gridOverlay?.setMapData(
      mapData.cells,
      mapData.width,
      mapData.height,
      mapData.triggerCellIds ?? []
    );

    // Map is ready for actors. World actor container will be re-created
    // when MAP_ACTORS calls clearWorldActors + addWorldActor.
  }

  /**
   * Prepare world actors for the new map.
   * Destroys old actor container + renderer and creates fresh ones.
   * Called by GameClient right before adding MAP_ACTORS.
   */
  prepareWorldActors(): void {
    this.initWorldActorContainer();
  }

  /**
   * Reveal the map container after map + actors are ready.
   * Called by GameClient after MAP_ACTORS have been added.
   * Crossfades old snapshot out while unblurring the new map.
   */
  async revealMap(): Promise<void> {
    await this.mapTransition?.reveal();
  }

  /** Set the player character ID (used for tracking). */
  setDebugPlayerId(_id: number): void {
    // Reserved for future use
  }

  // ============================================================================
  // World Actor Methods (Roleplay Mode)
  // ============================================================================

  private initWorldActorContainer(): void {
    if (!this.mapContainer) return;

    // Destroy previous
    if (this.worldActorRenderer) {
      this.worldActorRenderer.destroy();
      this.worldActorRenderer = null;
    }
    if (this.worldActorContainer) {
      this.mapContainer.removeChild(this.worldActorContainer);
      this.worldActorContainer.destroy({ children: true });
    }

    this.worldActorContainer = new Container();
    this.worldActorContainer.label = "world-actors";
    this.worldActorContainer.sortableChildren = true;
    this.mapContainer.addChild(this.worldActorContainer);

    const mapWidth = this.currentMapData?.width ?? 15;

    this.worldActorRenderer = new FighterRenderer(this.worldActorContainer, {
      mapWidth,
      groundLevel: 7,
      cellDataMap: this.cellDataMap,
      pickingSystem: this.pickingSystem,
    });

    this.rendererRegistry.register("world-actor-renderer", (e) => this.worldActorRenderer!.onResize(e));
  }

  /**
   * Add a world actor (player/NPC) to the map.
   * Returns a promise that resolves when the sprite is loaded.
   */
  async addWorldActor(data: WorldActorData): Promise<void> {
    if (!this.worldActorRenderer) {
      this.initWorldActorContainer();
    }

    await (
      this.worldActorRenderer?.addFighter({
        id: data.id,
        name: data.name,
        team: data.isCurrentPlayer ? 1 : 0, // Blue for self, red for others
        cellId: data.cellId,
        direction: data.direction,
        look: data.look,
        hp: 100,
        maxHp: 100,
        isPlayer: data.isCurrentPlayer,
      }) ?? Promise.resolve()
    );

    this.registerFighterForPicking(data.id, this.worldActorRenderer!);
    this.pickingSystem?.markDirty();
  }

  /**
   * Remove a world actor from the map.
   */
  removeWorldActor(id: number): void {
    const pickableId = this.fighterIdToPickableId.get(id);
    if (pickableId !== undefined) {
      this.pickingSystem?.unregisterObject(pickableId);
      this.interactiveCallbacks.delete(pickableId);
      this.fighterIdToPickableId.delete(id);
    }

    this.worldActorRenderer?.removeFighter(id);
  }

  /**
   * Move a world actor along a path.
   */
  async moveWorldActor(id: number, path: number[]): Promise<void> {
    await this.worldActorRenderer?.moveFighter(id, path);
  }

  /**
   * Clear all world actors.
   */
  clearWorldActors(): void {
    this.worldActorRenderer?.clear();
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
      console.error("Failed to load interactive objects:", error);
    }
  }

  private isInteractiveTile(tileId: number): boolean {
    return this.interactiveGfxIds.has(tileId);
  }

  private registerPickableObject(
    pickableId: number,
    sprite: Sprite,
    gfxId: number
  ): void {
    if (!this.pickingSystem) {
      return;
    }

    this.pickingSystem.registerObject({
      id: pickableId,
      sprite,
    });
    this.pickableIdToGfxId.set(pickableId, gfxId);
  }

  private clearPickableObjects(): void {
    if (this.pickingSystem) {
      this.pickingSystem.clear();
    }
    this.pickableIdToGfxId.clear();
    this.nextPickableId = 1;
  }

  private registerFighterForPicking(
    fighterId: number,
    renderer: FighterRenderer,
  ): void {
    const data = renderer.getFighterPickingData(fighterId);
    if (!data || !this.pickingSystem) return;

    const pickableId = this.nextPickableId++;
    this.pickingSystem.registerObject({
      id: pickableId,
      sprite: data.sprite,
      parentContainer: data.container,
    });
    this.interactiveCallbacks.set(pickableId, {
      onHover: (hovered) => {
        if (hovered) renderer.showName(fighterId);
        else renderer.hideName(fighterId);
      },
      onClick: null,
    });
    this.fighterIdToPickableId.set(fighterId, pickableId);
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

  private handleZoomChange(zoom: number, _index: number): void {
    // Debounce rapid zoom changes to prevent race conditions
    this.pendingZoom = zoom;

    if (this.zoomDebounceTimer) {
      clearTimeout(this.zoomDebounceTimer);
    }

    this.zoomDebounceTimer = setTimeout(() => {
      this.zoomDebounceTimer = null;
      if (this.pendingZoom !== null) {
        this.executeZoomRender(this.pendingZoom);
        this.pendingZoom = null;
      }
    }, 100); // 100ms debounce
  }

  private async executeZoomRender(zoom: number): Promise<void> {
    if (
      !this.currentMapData ||
      !this.mapHandler ||
      !this.mapContainer ||
      !this.atlasLoader
    ) {
      return;
    }

    // Skip if already rendering - just update pending zoom
    if (this.isRendering) {
      this.pendingZoom = zoom;
      return;
    }

    // Check if zoom actually changed (with small tolerance for floating point)
    const currentZoom = this.atlasLoader.getZoom();
    const zoomChanged = Math.abs(currentZoom - zoom) > 0.001;

    if (!zoomChanged) {
      return;
    }

    this.isRendering = true;

    try {
      // Opt #7: Try texture-swap first (much faster than full rebuild)
      if (this.mapHandler.hasSpriteRefs()) {
        console.log("[Battlefield] Texture-swap zoom:", zoom);
        this.mapContainer.scale.set(zoom);
        const success = await this.mapHandler.updateTexturesForZoom(zoom);
        if (success) {
          return;
        }
        // Fall through to full rebuild if texture swap failed
      }

      // Full rebuild fallback
      this.atlasLoader.setZoom(zoom);

      console.log("[Battlefield] Full re-render at zoom:", zoom);

      this.clearPickableObjects();
      this.debugOverlay?.clear();
      this.mapHandler.clearCache();

      await this.mapHandler.renderMap(
        this.currentMapData,
        this.mapContainer,
        zoom,
        this.getViewport()
      );
    } catch (error) {
      console.error("[Battlefield] Render error:", error);
    } finally {
      this.isRendering = false;

      // Notify all renderers (fighters, overlays, etc.) of the new zoom
      const screenW = this.app?.screen.width ?? 0;
      const screenH = this.app?.screen.height ?? 0;
      this.notifyResize(zoom, screenW, screenH);

      // If another zoom was requested while rendering, handle it
      if (this.pendingZoom !== null && this.pendingZoom !== zoom) {
        const nextZoom = this.pendingZoom;
        this.pendingZoom = null;
        // Use setTimeout to break the call stack and prevent deep recursion
        setTimeout(() => this.executeZoomRender(nextZoom), 0);
      }
    }
  }

  private handleObjectClick(result: PickResult): void {
    if (this.currentContextMenu?.isOpen()) {
      this.currentContextMenu.hide();
    }

    // Direct callbacks (temporary bridge for fighters)
    const cb = this.interactiveCallbacks.get(result.object.id);
    if (cb?.onClick) {
      cb.onClick();
    }

    // Push to ECS for entities with Interactive component
    pushInteractionEvent({
      type: "click",
      pickableId: result.object.id,
    });

    // Fallback for non-ECS interactive tiles (zaap etc.)
    const gfxId = this.pickableIdToGfxId.get(result.object.id);
    if (gfxId) {
      const objData = this.interactiveObjectsData.get(gfxId);
      console.log("Clicked interactive object:", gfxId, objData);
      if (this.isZaap(result.object.id)) {
        this.showZaapContextMenu(result.x, result.y);
      }
    }
  }

  private handleObjectHover(result: PickResult | null): void {
    // Unhover previous via direct callbacks (temporary bridge)
    if (this.lastHoveredPickableId !== undefined && this.lastHoveredPickableId !== result?.object.id) {
      this.interactiveCallbacks.get(this.lastHoveredPickableId)?.onHover?.(false);
      this.lastHoveredPickableId = undefined;
    }
    if (result) {
      const cb = this.interactiveCallbacks.get(result.object.id);
      if (cb) {
        cb.onHover?.(true);
        this.lastHoveredPickableId = result.object.id;
      }
    }
    // Also push to ECS for entities that have Interactive component
    pushInteractionEvent({
      type: "hover",
      pickableId: result?.object.id ?? -1,
    });
  }

  private handleGroundClick(mapX: number, mapY: number): void {
    if (!this.currentMapData) return;

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

  /**
   * Check if a screen point falls over an open UI panel.
   */
  private isPointOverUI(x: number, y: number): boolean {
    if (this.worldMapPanel?.isVisible()) {
      return true;
    }
    const panels = [
      this.statsPanel, this.spellsPanel, this.inventoryPanel,
      this.questsPanel, this.friendsPanel, this.guildPanel,
      this.mountPanel, this.conquestPanel,
    ];
    for (const panel of panels) {
      if (panel?.isVisible()) {
        const bounds = panel.container.getBounds();
        if (
          x >= bounds.x &&
          x <= bounds.x + bounds.width &&
          y >= bounds.y &&
          y <= bounds.y + bounds.height
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /** All managed panels mapped to their banner button key */
  private get panelMap() {
    return {
      stats: { panel: this.statsPanel, setPressed: (p: boolean) => this.banner?.setStatsPressed(p) },
      spells: { panel: this.spellsPanel, setPressed: (p: boolean) => this.banner?.setSpellsPressed(p) },
      inventory: { panel: this.inventoryPanel, setPressed: (p: boolean) => this.banner?.setInventoryPressed(p) },
      quests: { panel: this.questsPanel, setPressed: (p: boolean) => this.banner?.setQuestsPressed(p) },
      friends: { panel: this.friendsPanel, setPressed: (p: boolean) => this.banner?.setFriendsPressed(p) },
      guild: { panel: this.guildPanel, setPressed: (p: boolean) => this.banner?.setGuildPressed(p) },
      mount: { panel: this.mountPanel, setPressed: (p: boolean) => this.banner?.setMountPressed(p) },
      conquest: { panel: this.conquestPanel, setPressed: (p: boolean) => this.banner?.setConquestPressed(p) },
    } as const;
  }

  private closeAllPanels(): void {
    const map = this.panelMap;
    const keys = Object.keys(map) as Array<keyof typeof map>;
    for (const key of keys) {
      const { panel, setPressed } = map[key];
      if (panel?.isVisible()) {
        panel.hide();
        setPressed(false);
      }
    }
  }

  private togglePanel(key: keyof Battlefield['panelMap']): void {
    const map = this.panelMap;
    const entry = map[key];
    const wasVisible = entry.panel?.isVisible();
    this.closeAllPanels();
    if (!wasVisible) {
      entry.panel?.show();
      entry.setPressed(true);
    }
  }

  private updatePanelPositions(): void {
    if (!this.app) return;
    const zoom = this.engine.getBaseZoom();
    const bannerY = Math.floor(DISPLAY_HEIGHT * zoom);

    // Update world map panel area
    this.worldMapPanel?.setArea(this.app.screen.width, bannerY);

    // Position each panel above the banner, right-aligned
    const screenW = this.app.screen.width;
    const positionPanel = (panel: { rebuild: (z: number) => void; setPosition: (x: number, y: number) => void; panelW: number; panelH: number } | null) => {
      if (!panel) return;
      panel.rebuild(zoom);
      panel.setPosition(
        Math.round(screenW - panel.panelW - 4),
        Math.round(bannerY - panel.panelH),
      );
    };

    positionPanel(this.statsPanel);
    positionPanel(this.spellsPanel);
    positionPanel(this.inventoryPanel);
    positionPanel(this.questsPanel);
    positionPanel(this.friendsPanel);
    positionPanel(this.guildPanel);
    positionPanel(this.mountPanel);
    positionPanel(this.conquestPanel);
  }

  setOnCellClick(callback: (cellId: number) => void): void {
    this.onCellClickCallback = callback;
  }

  setOnMinimapTeleport(callback: (mapId: number) => void): void {
    this.onMinimapTeleportCallback = callback;
  }

  setOnBoostStat(callback: (statId: number) => void): void {
    this.onBoostStatCallback = callback;
  }

  getStatsPanel(): StatsPanel | null {
    return this.statsPanel;
  }

  getInventoryPanel(): InventoryPanel | null {
    return this.inventoryPanel;
  }

  getWorldMapPanel(): WorldMapPanel | null {
    return this.worldMapPanel;
  }

  toggleWorldMap(): void {
    this.closeAllPanels();
    const wasVisible = this.worldMapPanel?.isVisible() ?? false;
    this.worldMapPanel?.toggle(this.currentMapId ?? undefined);
    this.banner?.setMapPressed(!wasVisible);
    if (this.interactionHandler) {
      this.interactionHandler.enabled = wasVisible;
    }
  }

  private isZaap(pickableId: number): boolean {
    const gfxId = this.pickableIdToGfxId.get(pickableId);

    if (!gfxId) {
      return false;
    }

    const objInfo = this.interactiveObjectsData.get(gfxId);
    return objInfo?.type === 3;
  }

  private showZaapContextMenu(x: number, y: number): void {
    if (this.currentContextMenu) {
      this.currentContextMenu.destroy();
    }

    const onUse = () => {
      console.log("Zaap: Use action triggered");
    };

    this.currentContextMenu = new ZaapContextMenu(onUse);

    if (this.app?.stage) {
      this.currentContextMenu.show(x, y, this.app.stage);
    }
  }

  handleWheel(_e: WheelEvent): void {
    // Handled by interaction handler via canvas event
  }

  handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  getStats(): RenderStats {
    return this.engine.getStats();
  }

  getMapData(): MapData | null {
    return this.currentMapData;
  }

  /**
   * Get per-cell ground data for positioning actors correctly.
   */
  getCellGroundData(cellId: number): {
    groundLevel: number;
    groundSlope: number;
  } {
    const cell = this.cellDataMap.get(cellId);
    return {
      groundLevel: cell?.groundLevel ?? 7,
      groundSlope: cell?.groundSlope ?? 1,
    };
  }

  /**
   * Get the full cell data map for renderers.
   */
  getCellDataMap(): Map<number, CellData> {
    return this.cellDataMap;
  }

  destroy(): void {
    // Clean up map transition
    this.mapTransition?.destroy();
    this.mapTransition = null;

    // Clear zoom debounce timer
    if (this.zoomDebounceTimer) {
      clearTimeout(this.zoomDebounceTimer);
      this.zoomDebounceTimer = null;
    }
    this.pendingZoom = null;

    if (this.currentContextMenu) {
      this.currentContextMenu.destroy();
      this.currentContextMenu = null;
    }

    // Clean up ECS ticker
    if (this.ecsTickerCallback) {
      Ticker.shared.remove(this.ecsTickerCallback);
      this.ecsTickerCallback = null;
    }

    this.stressTest?.stop();
    this.stressTest = null;

    this.exitCombatMode();

    // Clean up renderer registry
    this.rendererRegistry.clear();
    this.interactiveCallbacks.clear();

    // Clean up world actors
    this.worldActorRenderer?.destroy();
    this.worldActorRenderer = null;
    if (this.worldActorContainer) {
      this.worldActorContainer.destroy({ children: true });
      this.worldActorContainer = null;
    }

    this.debugOverlay?.destroy();
    this.debugOverlay = null;
    this.gridOverlay?.destroy();
    this.gridOverlay = null;

    this.statsPanel?.destroy();
    this.statsPanel = null;
    this.spellsPanel?.destroy();
    this.spellsPanel = null;
    this.inventoryPanel?.destroy();
    this.inventoryPanel = null;
    this.questsPanel?.destroy();
    this.questsPanel = null;
    this.friendsPanel?.destroy();
    this.friendsPanel = null;
    this.guildPanel?.destroy();
    this.guildPanel = null;
    this.mountPanel?.destroy();
    this.mountPanel = null;
    this.conquestPanel?.destroy();
    this.conquestPanel = null;
    this.worldMapPanel?.destroy();
    this.worldMapPanel = null;
    this.interactionHandler?.destroy();
    this.pickingSystem?.destroy();
    this.atlasLoader?.clearCache();
    this.mapHandler?.clearCache();
    this.banner?.destroy();
    this.engine.destroy();
  }

  /**
   * Toggle debug overlay (hover over tiles to see info).
   * Press 'D' key to toggle.
   */
  toggleDebug(): boolean {
    return this.debugOverlay?.toggle() ?? false;
  }

  /**
   * Check if debug overlay is enabled.
   */
  isDebugEnabled(): boolean {
    return this.debugOverlay?.isEnabled() ?? false;
  }

  /**
   * Toggle grid overlay showing walkable/trigger cells.
   * Press 'G' key to toggle.
   */
  toggleGridOverlay(): boolean {
    return this.gridOverlay?.toggle() ?? false;
  }

  /**
   * Toggle the 1000-actor stress test.
   * Press 'T' key to toggle.
   */
  toggleStressTest(): boolean {
    if (this.stressTest) {
      this.stressTest.stop();
      this.stressTest = null;
      return false;
    }

    if (!this.worldActorRenderer || !this.currentMapData) return false;

    this.stressTest = new StressTest(
      this.worldActorRenderer,
      this.currentMapData.width,
      this.currentMapData.height,
      this.currentMapData.cells
    );
    this.stressTest.start();
    return true;
  }

  // ============================================================================
  // Combat Mode Methods
  // ============================================================================

  /**
   * Enter combat mode.
   */
  enterCombatMode(mode: CombatModeValue): void {
    if (this.combatMode !== CombatMode.NONE) {
      this.exitCombatMode();
    }

    if (!this.mapContainer) {
      return;
    }

    this.combatMode = mode;

    // Create combat container for all combat-related rendering
    this.combatContainer = new Container();
    this.combatContainer.label = "combat-container";
    this.combatContainer.sortableChildren = true;
    this.mapContainer.addChild(this.combatContainer);

    // Initialize combat renderers
    const mapWidth = this.currentMapData?.width ?? 15;
    const groundLevel = 7;

    this.cellHighlighter = new CellHighlighter(this.combatContainer, {
      mapWidth,
      groundLevel,
      cellDataMap: this.cellDataMap,
    });

    this.fighterRenderer = new FighterRenderer(this.combatContainer, {
      mapWidth,
      groundLevel,
      cellDataMap: this.cellDataMap,
      pickingSystem: this.pickingSystem,
    });

    this.damageRenderer = new DamageRenderer(this.combatContainer, {
      mapWidth,
      groundLevel,
      cellDataMap: this.cellDataMap,
    });

    this.spellRenderer = new SpellRenderer(this.combatContainer, {
      mapWidth,
      groundLevel,
      cellDataMap: this.cellDataMap,
    });

    // Register combat renderers
    this.rendererRegistry.register("cell-highlighter", (e) => this.cellHighlighter!.onResize(e));
    this.rendererRegistry.register("fighter-renderer", (e) => this.fighterRenderer!.onResize(e));
    this.rendererRegistry.register("damage-renderer", (e) => this.damageRenderer!.onResize(e));
    this.rendererRegistry.register("spell-renderer", (e) => this.spellRenderer!.onResize(e));
  }

  /**
   * Exit combat mode and cleanup.
   */
  exitCombatMode(): void {
    if (this.combatMode === CombatMode.NONE) {
      return;
    }

    this.spellRenderer?.destroy();
    this.spellRenderer = null;

    this.damageRenderer?.destroy();
    this.damageRenderer = null;

    this.fighterRenderer?.destroy();
    this.fighterRenderer = null;

    this.cellHighlighter?.destroy();
    this.cellHighlighter = null;

    // Clean up combat renderer registrations
    this.rendererRegistry.unregister("cell-highlighter");
    this.rendererRegistry.unregister("fighter-renderer");
    this.rendererRegistry.unregister("damage-renderer");
    this.rendererRegistry.unregister("spell-renderer");

    if (this.combatContainer) {
      this.mapContainer?.removeChild(this.combatContainer);
      this.combatContainer.destroy({ children: true });
      this.combatContainer = null;
    }

    this.combatMode = CombatMode.NONE;
  }

  /**
   * Get current combat mode.
   */
  getCombatMode(): CombatModeValue {
    return this.combatMode;
  }

  /**
   * Check if in combat mode.
   */
  isInCombat(): boolean {
    return this.combatMode !== CombatMode.NONE;
  }

  // ============================================================================
  // Fighter Methods
  // ============================================================================

  /**
   * Add a fighter to the battlefield.
   */
  addFighter(data: FighterSpriteData): void {
    this.fighterRenderer?.addFighter(data);
  }

  /**
   * Remove a fighter from the battlefield.
   */
  removeFighter(id: number): void {
    this.fighterRenderer?.removeFighter(id);
  }

  /**
   * Update fighter data.
   */
  updateFighter(id: number, data: Partial<FighterSpriteData>): void {
    this.fighterRenderer?.updateFighter(id, data);
  }

  /**
   * Move fighter along a path.
   */
  async moveFighter(id: number, path: number[]): Promise<void> {
    if (!this.fighterRenderer) {
      return;
    }

    await this.fighterRenderer.moveFighter(id, path);
  }

  /**
   * Teleport fighter to a cell.
   */
  teleportFighter(id: number, cellId: number): void {
    this.fighterRenderer?.teleportFighter(id, cellId);
  }

  /**
   * Set fighter animation.
   */
  setFighterAnimation(id: number, animation: FighterAnimationValue): void {
    this.fighterRenderer?.setAnimation(id, animation);
  }

  /**
   * Set fighter direction.
   */
  setFighterDirection(id: number, direction: number): void {
    this.fighterRenderer?.setDirection(id, direction);
  }

  // ============================================================================
  // Cell Highlight Methods
  // ============================================================================

  /**
   * Highlight cells.
   */
  highlightCells(cellIds: number[], type: HighlightTypeValue): void {
    this.cellHighlighter?.highlightCells(cellIds, type);
  }

  /**
   * Highlight a single cell.
   */
  highlightCell(cellId: number, type: HighlightTypeValue): void {
    this.cellHighlighter?.highlightCell(cellId, type);
  }

  /**
   * Clear highlights of a specific type.
   */
  clearHighlightType(type: HighlightTypeValue): void {
    this.cellHighlighter?.clearHighlightType(type);
  }

  /**
   * Clear all highlights.
   */
  clearAllHighlights(): void {
    this.cellHighlighter?.clearAll();
  }

  /**
   * Show movement range for a fighter.
   */
  showMovementRange(cellIds: number[]): void {
    this.cellHighlighter?.clearHighlightType(HighlightType.MOVEMENT);
    this.cellHighlighter?.highlightCells(cellIds, HighlightType.MOVEMENT);
  }

  /**
   * Show spell range.
   */
  showSpellRange(cellIds: number[]): void {
    this.cellHighlighter?.clearHighlightType(HighlightType.SPELL_RANGE);
    this.cellHighlighter?.highlightCells(cellIds, HighlightType.SPELL_RANGE);
  }

  /**
   * Show spell zone (area of effect).
   */
  showSpellZone(cellIds: number[]): void {
    this.cellHighlighter?.clearHighlightType(HighlightType.SPELL_ZONE);
    this.cellHighlighter?.highlightCells(cellIds, HighlightType.SPELL_ZONE);
  }

  /**
   * Show placement cells.
   */
  showPlacementCells(allyCells: number[], enemyCells: number[]): void {
    this.cellHighlighter?.highlightCells(
      allyCells,
      HighlightType.PLACEMENT_ALLY
    );
    this.cellHighlighter?.highlightCells(
      enemyCells,
      HighlightType.PLACEMENT_ENEMY
    );
  }

  /**
   * Clear placement highlights.
   */
  clearPlacementHighlights(): void {
    this.cellHighlighter?.clearHighlightType(HighlightType.PLACEMENT_ALLY);
    this.cellHighlighter?.clearHighlightType(HighlightType.PLACEMENT_ENEMY);
  }

  // ============================================================================
  // Spell & Damage Methods
  // ============================================================================

  /**
   * Play spell animation.
   */
  async playSpell(config: SpellAnimationConfig): Promise<void> {
    if (!this.spellRenderer) {
      return;
    }

    await this.spellRenderer.playSpell(config);
  }

  /**
   * Show damage number.
   */
  showDamage(config: DamageDisplayConfig): void {
    this.damageRenderer?.showDamage(config);
  }

  /**
   * Show damage on a cell.
   */
  showDamageAtCell(
    cellId: number,
    value: number,
    element?: number,
    critical?: boolean
  ): void {
    this.damageRenderer?.showDamage({
      cellId,
      value,
      type: DamageType.DAMAGE,
      element,
      critical,
    });
  }

  /**
   * Show healing on a cell.
   */
  showHealAtCell(cellId: number, value: number, critical?: boolean): void {
    this.damageRenderer?.showDamage({
      cellId,
      value,
      type: DamageType.HEAL,
      critical,
    });
  }

  // ============================================================================
  // Combat Offset/Scale Synchronization
  // ============================================================================

  /**
   * Update combat renderers with camera offset.
   */
  updateCombatOffset(x: number, y: number): void {
    this.cellHighlighter?.setOffset(x, y);
    this.fighterRenderer?.setOffset(x, y);
    this.damageRenderer?.setOffset(x, y);
    this.spellRenderer?.setOffset(x, y);
  }

  /**
   * Update combat renderers with scale.
   */
  updateCombatScale(scale: number): void {
    this.cellHighlighter?.setScale(scale);
    this.fighterRenderer?.setScale(scale);
    this.damageRenderer?.setScale(scale);
    this.spellRenderer?.setScale(scale);
  }

  /**
   * Update map dimensions for combat renderers.
   */
  updateCombatMapDimensions(width: number, groundLevel?: number): void {
    this.cellHighlighter?.setMapDimensions(width, groundLevel);
    this.fighterRenderer?.setMapDimensions(width, groundLevel);
    this.damageRenderer?.setMapDimensions(width, groundLevel);
    this.spellRenderer?.setMapDimensions(width, groundLevel);
  }

  // ============================================================================
  // Combat Accessors
  // ============================================================================

  /**
   * Get the cell highlighter.
   */
  getCellHighlighter(): CellHighlighter | null {
    return this.cellHighlighter;
  }

  /**
   * Get the fighter renderer.
   */
  getFighterRenderer(): FighterRenderer | null {
    return this.fighterRenderer;
  }

  /**
   * Get the damage renderer.
   */
  getDamageRenderer(): DamageRenderer | null {
    return this.damageRenderer;
  }

  /**
   * Get the spell renderer.
   */
  getSpellRenderer(): SpellRenderer | null {
    return this.spellRenderer;
  }

  /**
   * Clear all combat visuals (fighters, highlights, damage).
   */
  clearCombatVisuals(): void {
    this.cellHighlighter?.clearAll();
    this.fighterRenderer?.clear();
    this.damageRenderer?.clear();
    this.spellRenderer?.clear();
  }
}
