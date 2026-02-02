import { Container, Text, TextStyle, Ticker } from "pixi.js";

import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/constants/battlefield";
import { Element } from "@/ecs/components";

import { getCellPosition } from "./datacenter/cell";

/**
 * Damage display type.
 */
export const DamageType = {
  DAMAGE: "damage",
  HEAL: "heal",
  AP: "ap",
  MP: "mp",
  SHIELD: "shield",
} as const;

export type DamageTypeValue = (typeof DamageType)[keyof typeof DamageType];

/**
 * Damage display configuration.
 */
export interface DamageDisplayConfig {
  value: number;
  type: DamageTypeValue;
  cellId: number;
  element?: number;
  critical?: boolean;
}

/**
 * Active damage text animation.
 */
interface ActiveDamageText {
  text: Text;
  startY: number;
  elapsed: number;
  duration: number;
}

/**
 * Element colors for damage display.
 */
const ELEMENT_COLORS: Record<number, number> = {
  [Element.NEUTRAL]: 0xffffff,
  [Element.EARTH]: 0x8b4513,
  [Element.FIRE]: 0xff4500,
  [Element.WATER]: 0x1e90ff,
  [Element.AIR]: 0x90ee90,
};

/**
 * Type colors for non-damage displays.
 */
const TYPE_COLORS: Record<DamageTypeValue, number> = {
  [DamageType.DAMAGE]: 0xff0000,
  [DamageType.HEAL]: 0x00ff00,
  [DamageType.AP]: 0x0099ff,
  [DamageType.MP]: 0x00ff99,
  [DamageType.SHIELD]: 0x9966ff,
};

/**
 * Damage renderer configuration.
 */
export interface DamageRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
  animationDuration?: number;
  floatDistance?: number;
  groupDelay?: number;
}

/**
 * Damage number renderer.
 * Displays floating damage/heal numbers on the battlefield.
 */
export class DamageRenderer {
  private container: Container;
  private activeTexts: ActiveDamageText[] = [];
  private textPool: Text[] = [];
  private mapWidth: number;
  private groundLevel: number;
  private animationDuration: number;
  private floatDistance: number;
  private groupDelay: number;
  private pendingDamage: Map<number, DamageDisplayConfig[]> = new Map();
  private lastFlush: number = 0;
  private tickerCallback: () => void;

  constructor(parentContainer: Container, config: DamageRendererConfig = {}) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.animationDuration = config.animationDuration ?? 1500;
    this.floatDistance = config.floatDistance ?? 50;
    this.groupDelay = config.groupDelay ?? 50;

    this.container = new Container();
    this.container.label = "damage-renderer";
    this.container.sortableChildren = true;

    parentContainer.addChild(this.container);

    // Pre-populate pool
    for (let i = 0; i < 20; i++) {
      this.textPool.push(this.createText());
    }

    // Animation ticker
    this.tickerCallback = () => this.update();
    Ticker.shared.add(this.tickerCallback);
  }

  /**
   * Display damage/heal number.
   */
  showDamage(config: DamageDisplayConfig): void {
    // Group damage by cell for combining
    let pending = this.pendingDamage.get(config.cellId);

    if (!pending) {
      pending = [];
      this.pendingDamage.set(config.cellId, pending);
    }

    pending.push(config);

    // Schedule flush
    if (performance.now() - this.lastFlush > this.groupDelay) {
      this.flushPending();
    }
  }

  /**
   * Flush pending damage displays.
   */
  private flushPending(): void {
    this.lastFlush = performance.now();

    for (const [, damages] of this.pendingDamage) {
      // Combine same-type damages
      const combined = this.combineDamages(damages);

      for (let i = 0; i < combined.length; i++) {
        const damage = combined[i];
        const offset = i * 15; // Vertical offset for stacked numbers

        this.displayDamage(damage, offset);
      }
    }

    this.pendingDamage.clear();
  }

  /**
   * Combine damages of the same type.
   */
  private combineDamages(
    damages: DamageDisplayConfig[]
  ): DamageDisplayConfig[] {
    const byType = new Map<string, DamageDisplayConfig>();

    for (const damage of damages) {
      const key = `${damage.type}-${damage.element ?? 0}`;
      const existing = byType.get(key);

      if (existing) {
        existing.value += damage.value;
        existing.critical = existing.critical || damage.critical;
      } else {
        byType.set(key, { ...damage });
      }
    }

    return Array.from(byType.values());
  }

  /**
   * Display a single damage number.
   */
  private displayDamage(
    config: DamageDisplayConfig,
    yOffset: number = 0
  ): void {
    const text = this.acquireText();
    const pos = getCellPosition(config.cellId, this.mapWidth, this.groundLevel);

    // Position at cell center
    text.x = pos.x + CELL_HALF_WIDTH;
    text.y = pos.y + CELL_HALF_HEIGHT - yOffset;

    // Format text
    let displayValue = String(Math.abs(config.value));

    if (config.critical) {
      displayValue += "!";
    }

    if (
      config.type === DamageType.HEAL ||
      config.type === DamageType.AP ||
      config.type === DamageType.MP
    ) {
      displayValue = `+${displayValue}`;
    } else if (config.type === DamageType.DAMAGE) {
      displayValue = `-${displayValue}`;
    }

    text.text = displayValue;

    // Set color
    let color: number;

    if (config.type === DamageType.DAMAGE && config.element !== undefined) {
      color = ELEMENT_COLORS[config.element] ?? TYPE_COLORS[DamageType.DAMAGE];
    } else {
      color = TYPE_COLORS[config.type];
    }

    text.style.fill = color;

    // Set font size based on critical
    if (config.critical) {
      text.style.fontSize = 18;
    } else {
      text.style.fontSize = 14;
    }

    text.visible = true;
    text.alpha = 1;
    text.zIndex = 1000 + this.activeTexts.length;

    this.activeTexts.push({
      text,
      startY: text.y,
      elapsed: 0,
      duration: this.animationDuration,
    });
  }

  /**
   * Update animation tick.
   */
  private update(): void {
    const delta = Ticker.shared.deltaMS;

    for (let i = this.activeTexts.length - 1; i >= 0; i--) {
      const active = this.activeTexts[i];
      active.elapsed += delta;

      const progress = active.elapsed / active.duration;

      if (progress >= 1) {
        // Animation complete
        this.releaseText(active.text);
        this.activeTexts.splice(i, 1);
        continue;
      }

      // Ease out quad for smooth deceleration
      const easeProgress = 1 - (1 - progress) * (1 - progress);

      // Float upward
      active.text.y = active.startY - this.floatDistance * easeProgress;

      // Fade out in second half
      if (progress > 0.5) {
        active.text.alpha = 1 - (progress - 0.5) * 2;
      }
    }

    // Check for pending flushes
    if (
      this.pendingDamage.size > 0 &&
      performance.now() - this.lastFlush > this.groupDelay
    ) {
      this.flushPending();
    }
  }

  /**
   * Acquire text from pool.
   */
  private acquireText(): Text {
    const pooled = this.textPool.pop();

    if (pooled) {
      this.container.addChild(pooled);
      return pooled;
    }

    const text = this.createText();
    this.container.addChild(text);
    return text;
  }

  /**
   * Release text back to pool.
   */
  private releaseText(text: Text): void {
    text.visible = false;
    this.container.removeChild(text);
    this.textPool.push(text);
  }

  /**
   * Create new text object.
   */
  private createText(): Text {
    const style = new TextStyle({
      fontFamily: "Arial",
      fontSize: 14,
      fontWeight: "bold",
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 3 },
      align: "center",
    });

    const text = new Text({ text: "", style });
    text.anchor.set(0.5, 0.5);
    text.visible = false;

    return text;
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
   * Clear all active damage displays.
   */
  clear(): void {
    for (const active of this.activeTexts) {
      this.releaseText(active.text);
    }

    this.activeTexts = [];
    this.pendingDamage.clear();
  }

  /**
   * Destroy the renderer.
   */
  destroy(): void {
    Ticker.shared.remove(this.tickerCallback);

    this.clear();

    for (const text of this.textPool) {
      text.destroy();
    }

    this.textPool = [];
    this.container.destroy();
  }
}
