import { Container } from "pixi.js";

import type { CellData } from "@/ank/battlefield/datacenter/cell";
import type { PickingSystem } from "@/render/picking-system";
import type { RendererRegistry } from "@/render/renderer-registry";
import {
  CellHighlighter,
  HighlightType,
  type HighlightTypeValue,
} from "@/ank/battlefield/cell-highlighter";
import {
  type DamageDisplayConfig,
  DamageRenderer,
  DamageType,
} from "@/ank/battlefield/damage-renderer";
import type { CharacterSpriteLoader } from "@/ank/battlefield/character-sprite";
import {
  type FighterAnimationValue,
  FighterRenderer,
  type FighterSpriteData,
} from "@/ank/battlefield/fighter-renderer";
import {
  type SpellAnimationConfig,
  SpellRenderer,
} from "@/ank/battlefield/spell-renderer";

export class CombatUI {
  private combatMode: string = "none";
  private combatContainer: Container | null = null;
  private cellHighlighter: CellHighlighter | null = null;
  private fighterRenderer: FighterRenderer | null = null;
  private damageRenderer: DamageRenderer | null = null;
  private spellRenderer: SpellRenderer | null = null;

  constructor(
    private mapContainer: Container | null,
    private cellDataMap: Map<number, CellData>,
    private pickingSystem: PickingSystem | null,
    private rendererRegistry: RendererRegistry,
    private currentMapData: { width: number; height: number } | null,
    private spriteLoader: CharacterSpriteLoader
  ) {}

  /**
   * Enter combat mode.
   */
  enterCombatMode(mode: string): void {
    if (this.combatMode !== "none") {
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
      spriteLoader: this.spriteLoader,
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
    this.rendererRegistry.register("cell-highlighter", (e) =>
      this.cellHighlighter!.onResize(e)
    );
    this.rendererRegistry.register("fighter-renderer", (e) =>
      this.fighterRenderer!.onResize(e)
    );
    this.rendererRegistry.register("damage-renderer", (e) =>
      this.damageRenderer!.onResize(e)
    );
    this.rendererRegistry.register("spell-renderer", (e) =>
      this.spellRenderer!.onResize(e)
    );
  }

  /**
   * Exit combat mode and cleanup.
   */
  exitCombatMode(): void {
    if (this.combatMode === "none") {
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

    this.combatMode = "none";
  }

  /**
   * Get current combat mode.
   */
  getCombatMode(): string {
    return this.combatMode;
  }

  /**
   * Check if in combat mode.
   */
  isInCombat(): boolean {
    return this.combatMode !== "none";
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
   * Get the combat container.
   */
  getCombatContainer(): Container | null {
    return this.combatContainer;
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

  destroy(): void {
    this.exitCombatMode();
  }
}
