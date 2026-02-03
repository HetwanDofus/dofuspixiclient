import { LayoutSystem } from "@pixi/layout";
import {
  type Application,
  Container,
  extensions,
  type Sprite,
  TextureSource,
} from "pixi.js";

import type { InteractiveObjectData, PickResult, RenderStats } from "@/types";
import { ZaapContextMenu } from "@/ank/gapi/controls";
import { DISPLAY_HEIGHT } from "@/constants/battlefield";
import { Banner } from "@/hud/banner";
import { AtlasLoader } from "@/render/atlas-loader";
import { Engine } from "@/render/engine";
import { PickingSystem } from "@/render/picking-system";

import {
  CellHighlighter,
  HighlightType,
  type HighlightTypeValue,
} from "./cell-highlighter";
import {
  type DamageDisplayConfig,
  DamageRenderer,
  DamageType,
} from "./damage-renderer";
import { loadMapData, type MapData } from "./datacenter/map";
import { DebugOverlay } from "./debug-overlay";
import {
  type FighterAnimationValue,
  FighterRenderer,
  type FighterSpriteData,
} from "./fighter-renderer";
import { InteractionHandler } from "./interaction-handler";
import { MapHandler } from "./map-handler";
import { type SpellAnimationConfig, SpellRenderer } from "./spell-renderer";

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

export interface BattlefieldConfig {
  container: HTMLElement;
  backgroundColor?: number;
  preferWebGPU?: boolean;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  resizeDebounceMs?: number;
}

export class Battlefield {
  private container: HTMLElement;
  private engine: Engine;
  private app: Application | null = null;
  private mapContainer: Container | null = null;
  private atlasLoader: AtlasLoader | null = null;
  private mapHandler: MapHandler | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private pickingSystem: PickingSystem | null = null;
  private banner: Banner | null = null;

  private currentMapData: MapData | null = null;

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

  // Debug overlay
  private debugOverlay: DebugOverlay | null = null;

  private onResizeStartCallback?: () => void;
  private onResizeEndCallback?: () => void;

  // Render state management
  private isRendering = false;
  private pendingZoom: number | null = null;
  private zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: BattlefieldConfig) {
    this.container = config.container;
    this.onResizeStartCallback = config.onResizeStart;
    this.onResizeEndCallback = config.onResizeEnd;

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

    if (this.banner && this.app) {
      this.banner.resize(width, this.engine.getBaseZoom());
    }

    if (this.interactionHandler) {
      this.interactionHandler.setBaseZoom(this.engine.getBaseZoom());
    }

    if (this.debugOverlay) {
      this.debugOverlay.setScreenSize(width, height);
    }
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
      // Update zoom FIRST - this changes the cache key for new texture loads
      this.atlasLoader.setZoom(zoom);
      const newTargetScale = this.getTargetScaleForZoom();
      this.mapHandler.setTargetScale(newTargetScale);

      console.log("[Battlefield] Re-rendering map at zoom:", zoom);

      // Clear container - sprites will be recreated with new textures
      this.mapContainer.removeChildren();
      this.clearPickableObjects();
      this.debugOverlay?.clear();

      // Don't clear texture caches - they're keyed by zoom level

      await this.mapHandler.renderMap(
        this.currentMapData,
        this.mapContainer,
        zoom
      );
    } catch (error) {
      console.error("[Battlefield] Resize render error:", error);
    }

    if (this.onResizeEndCallback) {
      this.onResizeEndCallback();
    }
  }

  async init(): Promise<void> {
    await this.engine.init();
    this.app = this.engine.getApp();

    this.mapContainer = new Container();
    this.app.stage.addChild(this.mapContainer);

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
    this.app.stage.addChild(this.banner.getGraphics());

    this.app.stage.eventMode = "static";
    this.mapContainer.eventMode = "static";

    this.interactionHandler = new InteractionHandler({
      mapContainer: this.mapContainer,
      pickingSystem: this.pickingSystem,
      canvas,
      onZoomChange: (zoom, index) => this.handleZoomChange(zoom, index),
      onObjectClick: (result) => this.handleObjectClick(result),
      onObjectHover: (result) => this.handleObjectHover(result),
    });
    this.interactionHandler.init();
    this.interactionHandler.setBaseZoom(this.engine.getBaseZoom());

    this.app.stage.on("pointerdown", (e) =>
      this.interactionHandler?.handlePointerDown(e)
    );
    this.app.stage.on("pointermove", (e) =>
      this.interactionHandler?.handlePointerMove(e)
    );
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
  }

  async loadManifest(): Promise<void> {
    if (!this.atlasLoader) {
      return;
    }

    this.mapHandler = new MapHandler({
      atlasLoader: this.atlasLoader,
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

    this.mapContainer.x = 0;
    this.mapContainer.y = 0;

    this.clearPickableObjects();
    this.debugOverlay?.clear();

    const targetScale = this.getTargetScaleForZoom();
    this.mapHandler.setTargetScale(targetScale);

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    // Set zoom on atlas loader for crisp SVG rasterization at current zoom level
    this.atlasLoader.setZoom(zoom);
    await this.mapHandler.renderMap(mapData, this.mapContainer, zoom);
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

  private getTargetScaleForZoom(): number {
    const effectiveZoom =
      this.interactionHandler?.getZoom() ?? this.engine.getZoom();

    // Available asset scales: 1.5, 2, 2.5, 3, 3.5, 4
    const assetScales = [1.5, 2, 2.5, 3, 3.5, 4];

    // Find the smallest asset scale >= effective zoom
    for (const scale of assetScales) {
      if (scale >= effectiveZoom) {
        return scale;
      }
    }

    // If zoom exceeds all scales, use the highest
    return assetScales[assetScales.length - 1];
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
      // Update zoom FIRST - this changes the cache key for new texture loads
      this.atlasLoader.setZoom(zoom);
      const newTargetScale = this.getTargetScaleForZoom();
      this.mapHandler.setTargetScale(newTargetScale);

      console.log("[Battlefield] Re-rendering map at zoom (from zoom change):", zoom);

      // Clear container - sprites will be recreated with new textures
      this.mapContainer.removeChildren();
      this.clearPickableObjects();
      this.debugOverlay?.clear();

      // Don't clear texture caches - they're keyed by zoom level
      // Different zoom = different cache key = fresh texture load

      await this.mapHandler.renderMap(this.currentMapData, this.mapContainer, zoom);
    } catch (error) {
      console.error("[Battlefield] Render error:", error);
    } finally {
      this.isRendering = false;

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
    // Can be extended for hover effects
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

    if (this.app && this.app.stage) {
      this.currentContextMenu.show(x, y, this.app.stage);
    }
  }

  handleWheel(e: WheelEvent): void {
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

  destroy(): void {
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

    this.exitCombatMode();

    this.debugOverlay?.destroy();
    this.debugOverlay = null;

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
    const groundLevel = this.currentMapData?.groundLevel ?? 7;

    this.cellHighlighter = new CellHighlighter(this.combatContainer, {
      mapWidth,
      groundLevel,
    });

    this.fighterRenderer = new FighterRenderer(this.combatContainer, {
      mapWidth,
      groundLevel,
    });

    this.damageRenderer = new DamageRenderer(this.combatContainer, {
      mapWidth,
      groundLevel,
    });

    this.spellRenderer = new SpellRenderer(this.combatContainer, {
      mapWidth,
      groundLevel,
    });
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
