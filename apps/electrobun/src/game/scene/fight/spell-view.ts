import type {
  ISpellAnimation,
  SpellCallbacks,
  SpellContext,
} from "@dofus/spell-runtime";
import type { Container, Renderer } from "pixi.js";
import { SpellDisplayType } from "@dofus/spell-runtime";

import type { SpellVelloRenderer } from "@/game/render/spell-vello-renderer";
import type { Scene } from "@/game/scene/scene";
import {
  type LoadedSpell,
  SpellAssetLoader,
} from "@/game/assets/spell-asset-loader";
import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/game/constants/battlefield";
import { Z_OBJECT2_LAYER } from "@/game/constants/z-index";
import {
  type CellData,
  getCellPosition,
  getSlopeYOffset,
} from "@/game/datacenter/cell";
import { createLogger } from "@/utils/logger";

import { PreRenderedSpell, type SpellWorldCtx } from "./pre-rendered-spell";
import { SpellActor } from "./spell-actor";

/**
 * Canonical `VisualEffectHandler.MAX_INDEX` from
 * `assets/sources/client-code/ank/battlefield/VisualEffectHandler.as:11`.
 * Per-cast effect indices cycle 0..21 then wrap, ensuring simultaneous
 * spells on the same cell get distinct sub-offset depths
 * (`cellNum * 100 + 50 ± index`) and don't z-fight.
 */
const VISUAL_EFFECT_MAX_INDEX = 21;

const log = createLogger("SpellView");

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
  /**
   * AS2 displayType (10/11/12/20/21/30/31/40/41/50/51) — controls
   * where the spell container is anchored. Defaults to 11 (TargetCell)
   * which matches the most common impact-style behaviour in 1.29 and
   * preserves the v1 fix's anchor for spells without explicit metadata.
   */
  displayType?: number;
  /**
   * Fires once when the spell visual reports its HIT moment — for
   * projectile spells (displayType 30/31/40/41), this is exactly when
   * the projectile arrives at the target (the harness calls
   * `runtime.signalHit()` at the LANDED branch in clip/harness.ts).
   * For instant spells without a separate hit phase, this is invoked
   * synchronously alongside the visual launch. Used by the in-fight
   * sequencer chain to gate damage popups + recoil pose so they land
   * AT the projectile arrival, not when the cast pose ends.
   *
   * Idempotent — the runtime guards `signalHit()` so successive calls
   * are no-ops, but consumers can also assume single-fire.
   */
  onHit?: () => void;
}

export interface SpellRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
  cellDataMap?: Map<number, CellData>;
  /** Shared Vello renderer used by SpellAssetLoader to fetch + parse spell SWFs. */
  velloRenderer?: SpellVelloRenderer | null;
  /**
   * Pixi renderer used to wrap each spell's AVM1 GPU texture as an
   * `ExternalSource`. Required — without it the live-tick spell
   * pipeline can't produce visible pixels.
   */
  pixiRenderer: Renderer;
}

/**
 * Plays Dofus 1.29 spell animations. Each cast spawns a fresh spell
 * instance (bespoke TypeScript class if one ships under
 * `src/game/spells/spell-{id}.ts`, else the generic PreRenderedSpell)
 * and attaches its container directly to the battlefield's
 * `objectLayer2` at `targetCell * Z_OBJECT2_LAYER + 50`. That matches
 * the original VisualEffectHandler.as:35 behaviour: spell FX
 * interleave per-cell with fighters + object2 tiles, so a closer
 * sprite occludes farther-cell effects correctly.
 */
export class SpellRenderer {
  /**
   * Parent container spell instance containers are added to.
   * Intentionally the battlefield's objectLayer2 (or a fallback) so
   * each spell's zIndex participates in that layer's per-cell sort.
   */
  private readonly parent: Container;
  private readonly activeSpells = new Set<SpellActor>();
  private readonly assetLoader = new SpellAssetLoader();
  private readonly scene: Scene;
  private mapWidth: number;
  private groundLevel: number;
  private cellDataMap: Map<number, CellData>;
  private readonly pixiRenderer: Renderer;
  /**
   * Mirrors `VisualEffectHandler._incIndex` — monotonically advancing
   * counter that wraps at MAX_INDEX so each new cast on a cell gets a
   * distinct sub-offset slot (`cellNum * 100 + 50 ± index`).
   */
  private effectIndex = 0;
  /** Auto-increment placement id per cast for stable upsert/remove. */
  private nextSpellInstance = 0;

  constructor(
    parentContainer: Container,
    scene: Scene,
    config: SpellRendererConfig
  ) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.cellDataMap = config.cellDataMap ?? new Map();
    this.scene = scene;
    this.parent = parentContainer;
    this.pixiRenderer = config.pixiRenderer;

    if (config.velloRenderer) {
      this.assetLoader.setVelloRenderer(config.velloRenderer);
    } else {
      log.warn(
        "SpellRenderer: constructed without velloRenderer — every loadSpell() will return null and spell visuals will not appear. " +
          "Pass velloRenderer in SpellRendererConfig from the battlefield-scene wiring."
      );
    }
  }

  /** Exposed so the app can preload spells when entering fight. */
  getAssetLoader(): SpellAssetLoader {
    return this.assetLoader;
  }

  /** Resolves when the spell animation completes (onComplete fires). */
  async playSpell(config: SpellAnimationConfig): Promise<void> {
    const loaded = await this.assetLoader.loadSpell(config.spellId);

    if (!loaded) {
      log.warn(
        `spell ${config.spellId}: SWF bundle missing — cast resolves silently`
      );
      return;
    }

    const spell = await this.createSpellInstance(
      config.spellId,
      loaded,
      config.targetCellId
    );
    if (!spell) {
      log.warn(`spell ${config.spellId}: createSpellInstance returned null`);
      return;
    }

    return this.runSpell(config, spell, loaded);
  }

  private runSpell(
    config: SpellAnimationConfig,
    spell: ISpellAnimation,
    loaded: LoadedSpell
  ): Promise<void> {
    // RuntimeSpell instances expose their displayType so the harness
    // can position the container at the canonical AS anchor (caster
    // for 10/12/20/21/30/31/40/41, target for 11, world origin for
    // 50/51). Legacy PreRenderedSpell + AI-generated spells have no
    // displayType and fall back to TargetCell — that matches their
    // historical "anchor at target" assumption.
    const spellDisplayType =
      (spell as { displayType?: number }).displayType ?? config.displayType;
    const context = this.buildSpellContext(config, spellDisplayType);

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
        // Forward the canonical `runtime.signalHit()` to the caller —
        // for projectile spells (displayType 30/31/40/41) this fires
        // at the LANDED branch in clip/harness.ts, exactly when the
        // projectile arrives at the target. The in-fight sequencer
        // uses this signal to gate the damage popup + recoil pose so
        // they land AT impact, not at the end of the cast pose.
        onHit: () => {
          config.onHit?.();
        },
        onEvent: () => {},
      };

      try {
        spell.init(context, callbacks, loaded.textures);
      } catch (err) {
        log.warn(
          `spell ${config.spellId}: init threw — visual will be skipped. Error: ${String(err)}`
        );
        resolve();
        return;
      }

      // The spell mounts its real Pixi sprite directly into
      // `this.parent` from inside `PreRenderedSpell.init` (with the
      // anchor + depth that `createSpellInstance` baked into the
      // worldCtx). The empty `spell.container` is still attached so
      // any external code walking the Pixi tree finds a consistent
      // display node — unchanged interface-compatibility shim.
      spell.container.position.set(context.anchor.x, context.anchor.y);
      spell.container.zIndex = config.targetCellId * Z_OBJECT2_LAYER + 50;
      this.parent.addChild(spell.container);

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
    loaded: LoadedSpell,
    targetCellId: number
  ): Promise<ISpellAnimation | null> {
    // Every spell goes through the generic frame-stepper. AVM1
    // side-effects (gotoAndStop, _alpha fades, _rotation, etc.) are
    // baked into the rendered frames so the stepper just plays them
    // through. The cast mounts a Pixi sprite as a child of `parent`
    // (battlefield's objectLayer2) at the canonical sub-offset depth.
    // The visual anchor comes from `context.anchor` inside
    // `PreRenderedSpell.init` (so runtime-spell displayType shifts
    // are honored).
    const worldCtx: SpellWorldCtx = {
      pixiRenderer: this.pixiRenderer,
      parent: this.parent,
      placementId: `spell-${++this.nextSpellInstance}`,
      depth: this.allocateSpellDepth(targetCellId, true),
      resolution: loaded.resolution,
    };
    return new PreRenderedSpell(spellId, loaded, worldCtx);
  }

  /**
   * Compute the canonical sub-offset depth for a spell instance per
   * `VisualEffectHandler.as:35`:
   *   `depth = cellNum * 100 + 50 + sign * index`
   * where `sign = bInFrontOfSprite ? +1 : -1` and `index` cycles
   * `0..MAX_INDEX (21)`. Bumping the counter every cast disperses
   * simultaneous casts on the same cell across distinct depth slots
   * so they don't z-fight inside the unified Object2 sort.
   */
  private allocateSpellDepth(
    cellId: number,
    bInFrontOfSprite: boolean
  ): number {
    const idx = this.effectIndex;
    this.effectIndex = (this.effectIndex + 1) % (VISUAL_EFFECT_MAX_INDEX + 1);
    const sign = bInFrontOfSprite ? 1 : -1;
    return cellId * Z_OBJECT2_LAYER + 50 + sign * idx;
  }

  private buildSpellContext(
    config: SpellAnimationConfig,
    overrideDisplayType?: number
  ): SpellContext {
    const from = this.getCellPos(config.casterCellId);
    const to = this.getCellPos(config.targetCellId);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Per-spell instance displayType wins over the wire (the spell
    // module knows the canonical AS displayType for its visual gfx);
    // wire fallback handles legacy non-runtime spells.
    const displayType =
      overrideDisplayType ?? config.displayType ?? SpellDisplayType.TargetCell;
    const anchor = resolveAnchor(displayType, from, to);

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
      displayType,
      anchor,
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

  // Anchor table is in module scope — see resolveAnchor() at bottom.

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

  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;
    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  // Offset/scale live on the parent objectLayer2 / mapContainer, so
  // the SpellRenderer no longer owns its own Container to transform.
  // These no-ops are kept for legacy FightUI API shape.
  setScale(_scale: number): void {}
  setOffset(_x: number, _y: number): void {}
  onResize(_event: { zoom: number }): void {
    this.assetLoader.setResolution(_event.zoom);
  }

  clear(): void {
    for (const actor of Array.from(this.activeSpells)) {
      this.scene.remove(actor.id);
    }
    this.activeSpells.clear();
  }

  destroy(): void {
    this.clear();
    this.assetLoader.destroy();
  }
}

/**
 * Map an AS2 displayType to the world coords where the spell
 * container's origin (0,0) lands. Mirrors VisualEffectHandler.as:85-232:
 *
 *   case 10 / 12        → anchor at caster (`mc._x = _loc12_.x`)
 *   case 11             → anchor at target (`mc._x = _loc13_.x`)
 *   case 20 / 21        → anchor at caster, container is rotated to
 *                         face target; "shoot" attached at delta(target)
 *   case 30 / 31        → anchor at caster (-10 y), parabolic motion
 *   case 40 / 41        → anchor at caster, beam of duplicates to target
 *   case 50 / 51        → anchor at world origin (0,0); script handles
 *                         its own positioning from cellFrom/cellTo
 *
 * Anything outside the documented set falls back to TargetCell (11),
 * matching the v1 default behaviour.
 */
function resolveAnchor(
  displayType: number,
  caster: { x: number; y: number },
  target: { x: number; y: number }
): { x: number; y: number } {
  switch (displayType) {
    case SpellDisplayType.CasterCell:
    case SpellDisplayType.CasterCellAlt:
    case SpellDisplayType.ProjectileLinear:
    case SpellDisplayType.ProjectileLinearAlt:
    case SpellDisplayType.BeamLine:
    case SpellDisplayType.BeamLineAlt:
      return caster;
    case SpellDisplayType.ProjectileBallistic:
    case SpellDisplayType.ProjectileBallisticAlt:
      return { x: caster.x, y: caster.y - 10 };
    case SpellDisplayType.WorldAbsolute:
    case SpellDisplayType.WorldAbsoluteAlt:
      return { x: 0, y: 0 };
    case SpellDisplayType.TargetCell:
    default:
      return target;
  }
}
