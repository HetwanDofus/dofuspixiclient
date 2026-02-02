import { Container, Graphics, Ticker } from "pixi.js";

import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/constants/battlefield";

import { getCellPosition } from "./datacenter/cell";

/**
 * Spell animation type.
 */
export const SpellAnimationType = {
  CAST: "cast",
  PROJECTILE: "projectile",
  IMPACT: "impact",
  GLYPH: "glyph",
  TRAP: "trap",
} as const;

export type SpellAnimationTypeValue =
  (typeof SpellAnimationType)[keyof typeof SpellAnimationType];

/**
 * Spell animation configuration.
 */
export interface SpellAnimationConfig {
  spellId: number;
  casterCellId: number;
  targetCellId: number;
  critical?: boolean;
  element?: number;
}

/**
 * Active spell animation.
 */
interface ActiveAnimation {
  id: number;
  container: Container;
  graphics: Graphics;
  type: SpellAnimationTypeValue;
  elapsed: number;
  duration: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  resolve: () => void;
  element?: number;
  critical?: boolean;
}

/**
 * Spell renderer configuration.
 */
export interface SpellRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
}

/**
 * Spell animation renderer.
 * Handles spell cast, projectile, and impact animations.
 */
export class SpellRenderer {
  private container: Container;
  private animations: ActiveAnimation[] = [];
  private nextAnimationId = 0;
  private mapWidth: number;
  private groundLevel: number;
  private tickerCallback: () => void;

  constructor(parentContainer: Container, config: SpellRendererConfig = {}) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;

    this.container = new Container();
    this.container.label = "spell-renderer";
    this.container.sortableChildren = true;

    parentContainer.addChild(this.container);

    this.tickerCallback = () => this.update();
    Ticker.shared.add(this.tickerCallback);
  }

  /**
   * Play a full spell animation sequence.
   */
  async playSpell(config: SpellAnimationConfig): Promise<void> {
    // Play cast animation at caster
    await this.playCastAnimation(config.casterCellId, config.element);

    // Play projectile if different cells
    if (config.casterCellId !== config.targetCellId) {
      await this.playProjectile(
        config.casterCellId,
        config.targetCellId,
        config.element
      );
    }

    // Play impact animation at target
    await this.playImpactAnimation(
      config.targetCellId,
      config.element,
      config.critical
    );
  }

  /**
   * Play cast animation at a cell.
   */
  playCastAnimation(cellId: number, _element?: number): Promise<void> {
    return new Promise((resolve) => {
      const pos = getCellPosition(cellId, this.mapWidth, this.groundLevel);
      const x = pos.x + CELL_HALF_WIDTH;
      const y = pos.y + CELL_HALF_HEIGHT;

      const animContainer = new Container();
      animContainer.x = x;
      animContainer.y = y;
      animContainer.zIndex = 2000;

      const graphics = new Graphics();
      animContainer.addChild(graphics);

      this.container.addChild(animContainer);

      const anim: ActiveAnimation = {
        id: this.nextAnimationId++,
        container: animContainer,
        graphics,
        type: SpellAnimationType.CAST,
        elapsed: 0,
        duration: 300,
        startX: x,
        startY: y,
        endX: x,
        endY: y,
        resolve,
      };

      this.animations.push(anim);
    });
  }

  /**
   * Play projectile animation between cells.
   */
  playProjectile(
    fromCellId: number,
    toCellId: number,
    element?: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const fromPos = getCellPosition(
        fromCellId,
        this.mapWidth,
        this.groundLevel
      );
      const toPos = getCellPosition(toCellId, this.mapWidth, this.groundLevel);

      const startX = fromPos.x + CELL_HALF_WIDTH;
      const startY = fromPos.y + CELL_HALF_HEIGHT;
      const endX = toPos.x + CELL_HALF_WIDTH;
      const endY = toPos.y + CELL_HALF_HEIGHT;

      const animContainer = new Container();
      animContainer.x = startX;
      animContainer.y = startY;
      animContainer.zIndex = 3000;

      const graphics = new Graphics();
      this.drawProjectile(graphics, element);
      animContainer.addChild(graphics);

      this.container.addChild(animContainer);

      // Calculate duration based on distance
      const dx = endX - startX;
      const dy = endY - startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const duration = Math.min(500, Math.max(150, distance * 1.5));

      const anim: ActiveAnimation = {
        id: this.nextAnimationId++,
        container: animContainer,
        graphics,
        type: SpellAnimationType.PROJECTILE,
        elapsed: 0,
        duration,
        startX,
        startY,
        endX,
        endY,
        resolve,
      };

      this.animations.push(anim);
    });
  }

  /**
   * Play impact animation at a cell.
   */
  playImpactAnimation(
    cellId: number,
    element?: number,
    critical?: boolean
  ): Promise<void> {
    return new Promise((resolve) => {
      const pos = getCellPosition(cellId, this.mapWidth, this.groundLevel);
      const x = pos.x + CELL_HALF_WIDTH;
      const y = pos.y + CELL_HALF_HEIGHT;

      const animContainer = new Container();
      animContainer.x = x;
      animContainer.y = y;
      animContainer.zIndex = 2500;

      const graphics = new Graphics();
      animContainer.addChild(graphics);

      this.container.addChild(animContainer);

      const anim: ActiveAnimation = {
        id: this.nextAnimationId++,
        container: animContainer,
        graphics,
        type: SpellAnimationType.IMPACT,
        elapsed: 0,
        duration: critical ? 400 : 300,
        startX: x,
        startY: y,
        endX: x,
        endY: y,
        resolve,
      };

      anim.element = element;
      anim.critical = critical;

      this.animations.push(anim);
    });
  }

  /**
   * Play glyph animation at a cell.
   */
  playGlyphAnimation(cellId: number, element?: number): Promise<void> {
    return new Promise((resolve) => {
      const pos = getCellPosition(cellId, this.mapWidth, this.groundLevel);
      const x = pos.x + CELL_HALF_WIDTH;
      const y = pos.y + CELL_HALF_HEIGHT;

      const animContainer = new Container();
      animContainer.x = x;
      animContainer.y = y;
      animContainer.zIndex = 500;

      const graphics = new Graphics();
      animContainer.addChild(graphics);

      this.container.addChild(animContainer);

      const anim: ActiveAnimation = {
        id: this.nextAnimationId++,
        container: animContainer,
        graphics,
        type: SpellAnimationType.GLYPH,
        elapsed: 0,
        duration: 500,
        startX: x,
        startY: y,
        endX: x,
        endY: y,
        resolve,
      };

      anim.element = element;

      this.animations.push(anim);
    });
  }

  /**
   * Update animation tick.
   */
  private update(): void {
    const delta = Ticker.shared.deltaMS;

    for (let i = this.animations.length - 1; i >= 0; i--) {
      const anim = this.animations[i];
      anim.elapsed += delta;

      const progress = Math.min(1, anim.elapsed / anim.duration);

      switch (anim.type) {
        case SpellAnimationType.CAST:
          this.updateCastAnimation(anim, progress);
          break;

        case SpellAnimationType.PROJECTILE:
          this.updateProjectileAnimation(anim, progress);
          break;

        case SpellAnimationType.IMPACT:
          this.updateImpactAnimation(anim, progress);
          break;

        case SpellAnimationType.GLYPH:
          this.updateGlyphAnimation(anim, progress);
          break;
      }

      if (progress >= 1) {
        this.container.removeChild(anim.container);
        anim.container.destroy({ children: true });
        this.animations.splice(i, 1);
        anim.resolve();
      }
    }
  }

  /**
   * Update cast animation.
   */
  private updateCastAnimation(anim: ActiveAnimation, progress: number): void {
    anim.graphics.clear();

    const radius = 20 * (1 - progress * 0.5);
    const alpha = 1 - progress;

    // Expanding ring
    anim.graphics.circle(0, -15, radius);
    anim.graphics.stroke({ color: 0xffffff, width: 3, alpha });
  }

  /**
   * Update projectile animation.
   */
  private updateProjectileAnimation(
    anim: ActiveAnimation,
    progress: number
  ): void {
    // Ease out for deceleration at end
    const easedProgress = 1 - (1 - progress) ** 2;

    anim.container.x = anim.startX + (anim.endX - anim.startX) * easedProgress;
    anim.container.y = anim.startY + (anim.endY - anim.startY) * easedProgress;

    // Slight arc
    const arcHeight = -30;
    const arcProgress = Math.sin(progress * Math.PI);
    anim.container.y += arcHeight * arcProgress;
  }

  /**
   * Update impact animation.
   */
  private updateImpactAnimation(anim: ActiveAnimation, progress: number): void {
    anim.graphics.clear();

    const critical = anim.critical;
    const maxRadius = critical ? 35 : 25;
    const radius = maxRadius * progress;
    const alpha = 1 - progress;

    // Expanding circle
    anim.graphics.circle(0, -10, radius);
    anim.graphics.fill({ color: 0xff6600, alpha: alpha * 0.5 });
    anim.graphics.stroke({ color: 0xffff00, width: 2, alpha });

    if (critical) {
      // Extra ring for critical
      anim.graphics.circle(0, -10, radius * 0.7);
      anim.graphics.stroke({ color: 0xff0000, width: 3, alpha });
    }
  }

  /**
   * Update glyph animation.
   */
  private updateGlyphAnimation(anim: ActiveAnimation, progress: number): void {
    anim.graphics.clear();

    const alpha = progress < 0.5 ? progress * 2 : 1;
    const scale = 0.5 + progress * 0.5;

    // Diamond glyph shape
    const size = 20 * scale;
    const points = [0, -size, size, 0, 0, size, -size, 0];

    anim.graphics.poly(points);
    anim.graphics.fill({ color: 0x9966ff, alpha: alpha * 0.4 });
    anim.graphics.stroke({ color: 0xcc99ff, width: 2, alpha });
  }

  /**
   * Draw projectile graphic.
   */
  private drawProjectile(graphics: Graphics, element?: number): void {
    const color = this.getElementColor(element);

    // Glowing orb
    graphics.circle(0, 0, 8);
    graphics.fill({ color, alpha: 0.8 });
    graphics.stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
  }

  /**
   * Get color for element.
   */
  private getElementColor(element?: number): number {
    switch (element) {
      case 1:
        return 0x8b4513; // Earth
      case 2:
        return 0xff4500; // Fire
      case 3:
        return 0x1e90ff; // Water
      case 4:
        return 0x90ee90; // Air
      default:
        return 0xffffff; // Neutral
    }
  }

  /**
   * Set map dimensions.
   */
  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;

    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  /**
   * Update container position.
   */
  setOffset(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  /**
   * Set container scale.
   */
  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  /**
   * Clear all active animations.
   */
  clear(): void {
    for (const anim of this.animations) {
      anim.container.destroy({ children: true });
      anim.resolve();
    }

    this.animations = [];
    this.container.removeChildren();
  }

  /**
   * Destroy the renderer.
   */
  destroy(): void {
    Ticker.shared.remove(this.tickerCallback);
    this.clear();
    this.container.destroy();
  }
}
