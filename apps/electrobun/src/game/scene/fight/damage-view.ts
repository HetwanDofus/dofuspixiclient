import { Container, Text, TextStyle } from "pixi.js";

import type { Scene } from "@/game/scene/scene";
import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/game/constants/battlefield";
import { Z_DAMAGE_VIEW } from "@/game/constants/z-index";
import {
  type CellData,
  getCellPosition,
  getSlopeYOffset,
} from "@/game/datacenter/cell";
import { Element } from "@/game/fight/types";
import { Actor, type ActorId, freshActorId } from "@/game/scene/actor";
import { TICKABLE, type Tickable } from "@/game/scene/capabilities";

export const DamageType = {
  DAMAGE: "damage",
  HEAL: "heal",
  AP: "ap",
  MP: "mp",
  SHIELD: "shield",
} as const;

export type DamageTypeValue = (typeof DamageType)[keyof typeof DamageType];

export interface DamageDisplayConfig {
  value: number;
  type: DamageTypeValue;
  cellId: number;
  element?: number;
  critical?: boolean;
}

const ELEMENT_COLORS: Record<number, number> = {
  [Element.NEUTRAL]: 0xffffff,
  [Element.EARTH]: 0x8b4513,
  [Element.FIRE]: 0xff4500,
  [Element.WATER]: 0x1e90ff,
  [Element.AIR]: 0x90ee90,
};

const TYPE_COLORS: Record<DamageTypeValue, number> = {
  [DamageType.DAMAGE]: 0xff0000,
  [DamageType.HEAL]: 0x00ff00,
  [DamageType.AP]: 0x0099ff,
  [DamageType.MP]: 0x00ff99,
  [DamageType.SHIELD]: 0x9966ff,
};

export interface DamageRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
  animationDuration?: number;
  floatDistance?: number;
  groupDelay?: number;
  cellDataMap?: Map<number, CellData>;
}

/**
 * Tickable actor for a single floating damage number.
 * Self-removes from scene when animation completes.
 */
class DamageTextActor extends Actor implements Tickable {
  readonly id: ActorId;
  readonly [TICKABLE] = true as const;

  private elapsed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly text: Text,
    private readonly startY: number,
    private readonly floatDistance: number,
    private readonly duration: number,
    private readonly onComplete: (text: Text) => void
  ) {
    super();
    this.id = freshActorId();
  }

  update(dt: number): void {
    this.elapsed += dt;
    const progress = this.elapsed / this.duration;

    if (progress >= 1) {
      this.scene.remove(this.id);
      return;
    }

    const eased = 1 - (1 - progress) * (1 - progress);
    this.text.y = this.startY - this.floatDistance * eased;

    if (progress > 0.5) {
      this.text.alpha = 1 - (progress - 0.5) * 2;
    }
  }

  dispose(): void {
    this.onComplete(this.text);
  }
}

/**
 * Damage number renderer.
 * Spawns DamageTextActor instances into the scene; scene drives animation
 * via its Tickable bucket. No direct Ticker.shared.add.
 */
export class DamageRenderer {
  private container: Container;
  private textPool: Text[] = [];
  private mapWidth: number;
  private groundLevel: number;
  private animationDuration: number;
  private floatDistance: number;
  private groupDelay: number;
  private pendingDamage: Map<number, DamageDisplayConfig[]> = new Map();
  private lastFlush: number = 0;
  private cellDataMap: Map<number, CellData>;
  private readonly scene: Scene;
  private readonly spawnedIds = new Set<ActorId>();
  private readonly unsubPreTick: () => void;

  constructor(
    parentContainer: Container,
    scene: Scene,
    config: DamageRendererConfig = {}
  ) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.animationDuration = config.animationDuration ?? 1500;
    this.floatDistance = config.floatDistance ?? 50;
    this.groupDelay = config.groupDelay ?? 50;
    this.cellDataMap = config.cellDataMap ?? new Map();
    this.scene = scene;

    this.container = new Container();
    this.container.label = "damage-renderer";
    this.container.sortableChildren = true;

    parentContainer.addChild(this.container);

    for (let i = 0; i < 20; i++) {
      this.textPool.push(this.createText());
    }

    this.unsubPreTick = this.scene.onPreTick(() => this.flushIfDue());
  }

  showDamage(config: DamageDisplayConfig): void {
    let pending = this.pendingDamage.get(config.cellId);

    if (!pending) {
      pending = [];
      this.pendingDamage.set(config.cellId, pending);
    }

    pending.push(config);

    if (performance.now() - this.lastFlush > this.groupDelay) {
      this.flushPending();
    }
  }

  private flushIfDue(): void {
    if (
      this.pendingDamage.size > 0 &&
      performance.now() - this.lastFlush > this.groupDelay
    ) {
      this.flushPending();
    }
  }

  private flushPending(): void {
    this.lastFlush = performance.now();

    for (const [, damages] of this.pendingDamage) {
      const combined = this.combineDamages(damages);

      for (let i = 0; i < combined.length; i++) {
        const damage = combined[i];
        const offset = i * 15;
        this.displayDamage(damage, offset);
      }
    }

    this.pendingDamage.clear();
  }

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

  private getCellPos(cellId: number): { x: number; y: number } {
    const cell = this.cellDataMap.get(cellId);
    const level = cell?.groundLevel ?? this.groundLevel;
    const slope = cell?.groundSlope ?? 1;
    const pos = getCellPosition(cellId, this.mapWidth, level);
    return { x: pos.x, y: pos.y + getSlopeYOffset(slope) };
  }

  private displayDamage(
    config: DamageDisplayConfig,
    yOffset: number = 0
  ): void {
    const text = this.acquireText();
    const pos = this.getCellPos(config.cellId);

    text.x = pos.x;
    text.y = pos.y - yOffset;

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

    let color: number;

    if (config.type === DamageType.DAMAGE && config.element !== undefined) {
      color = ELEMENT_COLORS[config.element] ?? TYPE_COLORS[DamageType.DAMAGE];
    } else {
      color = TYPE_COLORS[config.type];
    }

    text.style.fill = color;
    text.style.fontSize = config.critical ? 18 : 14;

    text.visible = true;
    text.alpha = 1;
    text.zIndex = Z_DAMAGE_VIEW + this.spawnedIds.size;

    const actor = new DamageTextActor(
      this.scene,
      text,
      text.y,
      this.floatDistance,
      this.animationDuration,
      (t) => {
        this.spawnedIds.delete(actor.id);
        this.releaseText(t);
      }
    );

    this.spawnedIds.add(actor.id);
    this.scene.add(actor);
  }

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

  private releaseText(text: Text): void {
    text.visible = false;

    if (text.parent) {
      text.parent.removeChild(text);
    }

    this.textPool.push(text);
  }

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

  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;

    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  setOffset(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  onResize(event: { zoom: number }): void {
    this.setScale(event.zoom);
  }

  getContainer(): Container {
    return this.container;
  }

  clear(): void {
    for (const id of Array.from(this.spawnedIds)) {
      this.scene.remove(id);
    }

    this.spawnedIds.clear();
    this.pendingDamage.clear();
  }

  destroy(): void {
    this.unsubPreTick();
    this.clear();

    for (const text of this.textPool) {
      text.destroy();
    }

    this.textPool = [];

    this.container.destroy();
  }
}
