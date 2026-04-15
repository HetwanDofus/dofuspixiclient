import { Container } from "pixi.js";

import type { CharacterSpriteLoader } from "@/game/assets/character-sprite";
import type { CellData } from "@/game/datacenter/cell";
import type { PickingSystem } from "@/game/render/picking-system";
import type { RendererRegistry } from "@/game/render/renderer-registry";
import type { Scene } from "@/game/scene/scene";
import {
  type DamageDisplayConfig,
  DamageRenderer,
  DamageType,
} from "@/game/scene/fight/damage-view";
import {
  type SpellAnimationConfig,
  SpellRenderer,
} from "@/game/scene/fight/spell-view";
import {
  CellHighlighter,
  HighlightType,
  type HighlightTypeValue,
} from "@/game/scene/overlays/cell-highlighter";
import {
  type PlayerAnimationValue,
  PlayerRenderer,
  type PlayerSpriteData,
} from "@/game/scene/player/renderer";
import { fightActor } from "@/game/stores/fight-store";

export class FightUI {
  private fightContainer: Container | null = null;
  private cellHighlighter: CellHighlighter | null = null;
  private playerRenderer: PlayerRenderer | null = null;
  private damageRenderer: DamageRenderer | null = null;
  private spellRenderer: SpellRenderer | null = null;

  constructor(
    private mapContainer: Container | null,
    private cellDataMap: Map<number, CellData>,
    private pickingSystem: PickingSystem | null,
    private rendererRegistry: RendererRegistry,
    private currentMapData: { width: number; height: number } | null,
    private spriteLoader: CharacterSpriteLoader,
    private scene: Scene
  ) {}

  /**
   * Enter fight mode.
   */
  enterFightMode(_mode: string): void {
    if (this.fightContainer) {
      this.exitFightMode();
    }

    if (!this.mapContainer) {
      return;
    }

    // Create fight container for all fight-related rendering
    this.fightContainer = new Container();
    this.fightContainer.label = "fight-container";
    this.fightContainer.sortableChildren = true;
    this.mapContainer.addChild(this.fightContainer);

    // Initialize fight renderers
    const mapWidth = this.currentMapData?.width ?? 15;
    const groundLevel = 7;

    this.cellHighlighter = new CellHighlighter(this.fightContainer, {
      mapWidth,
      groundLevel,
      cellDataMap: this.cellDataMap,
    });
    this.scene.add(this.cellHighlighter);

    this.playerRenderer = new PlayerRenderer(this.fightContainer, {
      mapWidth,
      groundLevel,
      cellDataMap: this.cellDataMap,
      pickingSystem: this.pickingSystem,
      spriteLoader: this.spriteLoader,
      scene: this.scene,
    });

    this.damageRenderer = new DamageRenderer(this.fightContainer, this.scene, {
      mapWidth,
      groundLevel,
      cellDataMap: this.cellDataMap,
    });

    this.spellRenderer = new SpellRenderer(this.fightContainer, this.scene, {
      mapWidth,
      groundLevel,
      cellDataMap: this.cellDataMap,
    });

    // Register fight renderers
    this.rendererRegistry.register("cell-highlighter", (e) =>
      this.cellHighlighter?.onResize(e)
    );
    this.rendererRegistry.register("player-renderer", (e) =>
      this.playerRenderer?.onResize(e)
    );
    this.rendererRegistry.register("damage-renderer", (e) =>
      this.damageRenderer?.onResize(e)
    );
    this.rendererRegistry.register("spell-renderer", (e) =>
      this.spellRenderer?.onResize(e)
    );
  }

  /**
   * Exit fight mode and cleanup.
   */
  exitFightMode(): void {
    if (!this.fightContainer) {
      return;
    }

    this.spellRenderer?.destroy();
    this.spellRenderer = null;

    this.damageRenderer?.destroy();
    this.damageRenderer = null;

    this.playerRenderer?.destroy();
    this.playerRenderer = null;

    this.cellHighlighter?.destroy();
    this.cellHighlighter = null;

    // Clean up fight renderer registrations
    this.rendererRegistry.unregister("cell-highlighter");
    this.rendererRegistry.unregister("player-renderer");
    this.rendererRegistry.unregister("damage-renderer");
    this.rendererRegistry.unregister("spell-renderer");

    if (this.fightContainer) {
      this.mapContainer?.removeChild(this.fightContainer);
      this.fightContainer.destroy({ children: true });
      this.fightContainer = null;
    }
  }

  /**
   * Get current fight mode — read from fightActor (single source of truth).
   */
  getFightMode(): string {
    const v = fightActor.getSnapshot().value;

    if (typeof v === "string") {
      return v;
    }

    if (v && typeof v === "object" && "fighting" in v) {
      return "fighting";
    }

    return "none";
  }

  /**
   * Check if in fight mode.
   */
  isInFight(): boolean {
    return this.fightContainer !== null;
  }

  // ============================================================================
  // Player Methods
  // ============================================================================

  /**
   * Add a player to the battlefield.
   */
  addPlayer(data: PlayerSpriteData): void {
    this.playerRenderer?.addPlayer(data);
  }

  /**
   * Remove a player from the battlefield.
   */
  removePlayer(id: number): void {
    this.playerRenderer?.removePlayer(id);
  }

  /**
   * Update player data.
   */
  updatePlayer(id: number, data: Partial<PlayerSpriteData>): void {
    this.playerRenderer?.updatePlayer(id, data);
  }

  /**
   * Move player along a path.
   */
  async movePlayer(id: number, path: number[]): Promise<void> {
    if (!this.playerRenderer) {
      return;
    }

    await this.playerRenderer.movePlayer(id, path);
  }

  /**
   * Teleport player to a cell.
   */
  teleportPlayer(id: number, cellId: number): void {
    this.playerRenderer?.teleportPlayer(id, cellId);
  }

  /**
   * Set player animation.
   */
  setPlayerAnimation(id: number, animation: PlayerAnimationValue): void {
    this.playerRenderer?.setAnimation(id, animation);
  }

  /**
   * Set player direction.
   */
  setPlayerDirection(id: number, direction: number): void {
    this.playerRenderer?.setDirection(id, direction);
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
   * Show movement range for a player.
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
  // Fight Offset/Scale Synchronization
  // ============================================================================

  /**
   * Update fight renderers with camera offset.
   */
  updateFightOffset(x: number, y: number): void {
    this.cellHighlighter?.setOffset(x, y);
    this.playerRenderer?.setOffset(x, y);
    this.damageRenderer?.setOffset(x, y);
    this.spellRenderer?.setOffset(x, y);
  }

  /**
   * Update fight renderers with scale.
   */
  updateFightScale(scale: number): void {
    this.cellHighlighter?.setScale(scale);
    this.playerRenderer?.setScale(scale);
    this.damageRenderer?.setScale(scale);
    this.spellRenderer?.setScale(scale);
  }

  /**
   * Update map dimensions for fight renderers.
   */
  updateFightMapDimensions(width: number, groundLevel?: number): void {
    this.cellHighlighter?.setMapDimensions(width, groundLevel);
    this.playerRenderer?.setMapDimensions(width, groundLevel);
    this.damageRenderer?.setMapDimensions(width, groundLevel);
    this.spellRenderer?.setMapDimensions(width, groundLevel);
  }

  // ============================================================================
  // Fight Accessors
  // ============================================================================

  /**
   * Get the cell highlighter.
   */
  getCellHighlighter(): CellHighlighter | null {
    return this.cellHighlighter;
  }

  /**
   * Get the player renderer.
   */
  getPlayerRenderer(): PlayerRenderer | null {
    return this.playerRenderer;
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
   * Get the fight container.
   */
  getCombatContainer(): Container | null {
    return this.fightContainer;
  }

  /**
   * Clear all fight visuals (players, highlights, damage).
   */
  clearFightVisuals(): void {
    this.cellHighlighter?.clearAll();
    this.playerRenderer?.clear();
    this.damageRenderer?.clear();
    this.spellRenderer?.clear();
  }

  destroy(): void {
    this.exitFightMode();
  }
}
