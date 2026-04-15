import type {
  ISpellAnimation,
  SpellCallbacks,
  SpellContext,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

import type { Scene } from "@/game/scene/scene";
import {
  type LoadedSpell,
  SpellAssetLoader,
} from "@/game/assets/spell-asset-loader";
import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/game/constants/battlefield";
import { Z_SPELL_VIEW } from "@/game/constants/z-index";
import {
  type CellData,
  getCellPosition,
  getSlopeYOffset,
} from "@/game/datacenter/cell";

import { PreRenderedSpell } from "./pre-rendered-spell";
import { SpellActor } from "./spell-actor";
import { loadSpellClass } from "./spell-module-loader";

/** Legacy animation type enum — retained for public API compatibility. */
export const SpellAnimationType = {
  CAST: "cast",
  PROJECTILE: "projectile",
  IMPACT: "impact",
  GLYPH: "glyph",
  TRAP: "trap",
} as const;

export type SpellAnimationTypeValue =
  (typeof SpellAnimationType)[keyof typeof SpellAnimationType];

export interface SpellAnimationConfig {
  spellId: number;
  casterCellId: number;
  targetCellId: number;
  /** Caster's entity/player ID (for the spell context). Optional; defaults to 0. */
  casterId?: number;
  targetId?: number;
  /** Spell level 1-6. Affects particle counts, durations, etc. Defaults to 1. */
  spellLevel?: number;
  critical?: boolean;
  element?: number;
  /** Direction the caster is facing. True = right. Inferred from geometry if omitted. */
  casterFacingRight?: boolean;
  /** Sound playback callback. If omitted, sound triggers are logged but not played. */
  playSound?: (soundId: string) => void;
}

export interface SpellRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
  cellDataMap?: Map<number, CellData>;
}

/**
 * Plays real Dofus 1.29 spell animations — either a custom TypeScript class
 * (for spells with bespoke particle/physics logic) or a generic frame-stepping
 * PreRenderedSpell (everything else).
 */
export class SpellRenderer {
  private readonly container: Container;
  private readonly activeSpells = new Set<SpellActor>();
  private readonly assetLoader = new SpellAssetLoader();
  private readonly scene: Scene;
  private mapWidth: number;
  private groundLevel: number;
  private cellDataMap: Map<number, CellData>;

  constructor(
    parentContainer: Container,
    scene: Scene,
    config: SpellRendererConfig = {}
  ) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.cellDataMap = config.cellDataMap ?? new Map();
    this.scene = scene;

    this.container = new Container();
    this.container.label = "spell-renderer";
    this.container.sortableChildren = true;
    parentContainer.addChild(this.container);
  }

  /** Exposed so the app can preload spells when entering fight. */
  getAssetLoader(): SpellAssetLoader {
    return this.assetLoader;
  }

  getContainer(): Container {
    return this.container;
  }

  /** Resolves when the spell animation completes (onComplete fires). */
  async playSpell(config: SpellAnimationConfig): Promise<void> {
    const loaded = await this.assetLoader.loadSpell(config.spellId);

    if (!loaded) {
      console.warn(`Spell ${config.spellId} assets failed to load`);
      return;
    }

    const spell = await this.createSpellInstance(config.spellId, loaded);

    if (!spell) {
      console.warn(`Spell ${config.spellId} could not be instantiated`);
      return;
    }

    const context = this.buildSpellContext(config);
    const casterPos = this.getCellPos(config.casterCellId);

    return new Promise<void>((resolve) => {
      const actor = new SpellActor(this.scene, spell, resolve, (a) =>
        this.activeSpells.delete(a)
      );

      const callbacks: SpellCallbacks = {
        playSound: (soundId: string) => {
          config.playSound?.(soundId);
        },
        onComplete: () => {
          actor.markComplete();
          this.scene.remove(actor.id);
        },
        onHit: () => {},
        onEvent: () => {},
      };

      spell.init(context, callbacks, loaded.textures);

      spell.container.position.set(casterPos.x, casterPos.y);
      spell.container.zIndex = Z_SPELL_VIEW;
      this.container.addChild(spell.container);

      this.activeSpells.add(actor);
      this.scene.add(actor);
    });
  }

  /** Preload spell manifests + textures up-front to avoid first-cast hitches. */
  async preload(spellIds: number[]): Promise<void> {
    await this.assetLoader.preload(spellIds);
  }

  private async createSpellInstance(
    spellId: number,
    loaded: LoadedSpell
  ): Promise<ISpellAnimation | null> {
    if (loaded.manifest.spell.requiresTypeScript) {
      const SpellClass = await loadSpellClass(spellId);

      if (SpellClass) {
        return new SpellClass();
      }

      console.warn(
        `Spell ${spellId} requires TypeScript but no module exists — falling back to pre-rendered`
      );
    }

    return new PreRenderedSpell(spellId, loaded);
  }

  private buildSpellContext(config: SpellAnimationConfig): SpellContext {
    const from = this.getCellPos(config.casterCellId);
    const to = this.getCellPos(config.targetCellId);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    return {
      cellFrom: {
        cellId: config.casterCellId,
        x: from.x,
        y: from.y,
        groundLevel: this.getCellGroundLevel(config.casterCellId),
      },
      cellTo: {
        cellId: config.targetCellId,
        x: to.x,
        y: to.y,
        groundLevel: this.getCellGroundLevel(config.targetCellId),
      },
      angle: angleDeg,
      distance,
      level: config.spellLevel ?? 1,
      caster: {
        id: config.casterId ?? 0,
        name: "",
        team: 0,
        hp: 0,
        maxHp: 0,
        isPlayer: false,
      },
      target:
        config.targetId !== undefined
          ? {
              id: config.targetId,
              name: "",
              team: 0,
              hp: 0,
              maxHp: 0,
              isPlayer: false,
            }
          : undefined,
      casterFacingRight: config.casterFacingRight ?? dx >= 0,
      parentFrame: 0,
      instanceIndex: 0,
      isCritical: config.critical ?? false,
    };
  }

  private getCellPos(cellId: number): { x: number; y: number } {
    const cell = this.cellDataMap.get(cellId);
    const level = cell?.groundLevel ?? this.groundLevel;
    const slope = cell?.groundSlope ?? 1;
    const pos = getCellPosition(cellId, this.mapWidth, level);
    return { x: pos.x, y: pos.y + getSlopeYOffset(slope) };
  }

  private getCellGroundLevel(cellId: number): number {
    return this.cellDataMap.get(cellId)?.groundLevel ?? this.groundLevel;
  }

  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  setOffset(x: number, y: number): void {
    this.container.position.set(x, y);
  }

  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;

    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  onResize(event: { zoom: number }): void {
    this.setScale(event.zoom);
  }

  clear(): void {
    for (const actor of Array.from(this.activeSpells)) {
      this.scene.remove(actor.id);
    }

    this.activeSpells.clear();
    this.container.removeChildren();
  }

  destroy(): void {
    this.clear();
    this.assetLoader.destroy();
    this.container.destroy();
  }
}
