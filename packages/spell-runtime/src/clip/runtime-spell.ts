/**
 * RuntimeSpell — bridge between the existing `ISpellAnimation`
 * contract (used by spell-view + spell-actor in apps/electrobun) and
 * the new SpellClip / SpellRuntime composition primitives.
 *
 * Per-spell modules now extend `RuntimeSpell` instead of the legacy
 * `BaseSpell`. They override:
 *   - `displayType` (one of the canonical 1.29 values)
 *   - `registerSymbols(textures, ctx)` to populate the symbol registry
 *
 * Lifecycle:
 *   1. `init(ctx, callbacks, textures)` — the spell-view calls this.
 *      We create the runtime + root clip, call `registerSymbols`, then
 *      `configureHarness` to apply the canonical AS displayType setup.
 *   2. spell-view positions `this.container` at the displayType anchor
 *      (resolved via `resolveAnchor` in spell-view).
 *   3. The scene tick calls `update(deltaMs)` every render frame, which
 *      forwards to `runtime.tick(deltaMs)` — the runtime steps an
 *      integer number of Flash frames (30 fps baseline) regardless of
 *      screen framerate.
 *   4. `isComplete()` returns true once the per-spell module calls
 *      `runtime.complete()` (typically from the top-level final-frame
 *      script that does `_parent.removeMovieClip()` in canonical AS).
 */

import type { Container } from "pixi.js";

import type {
  ISpellAnimation,
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
} from "../spell-interface.ts";

import { SpellClip } from "./clip.ts";
import { configureHarness } from "./harness.ts";
import { SpellRuntime } from "./runtime.ts";
import { SymbolRegistry } from "./symbol-registry.ts";

export abstract class RuntimeSpell implements ISpellAnimation {
  abstract readonly spellId: number;
  /**
   * Canonical Dofus 1.29 displayType (10/11/12/20/21/30/31/40/41/50/51).
   * Drives how `configureHarness` anchors + animates the root clip.
   */
  abstract readonly displayType: number;

  readonly container: Container;
  protected readonly root: SpellClip;
  protected readonly registry: SymbolRegistry;

  // Set in `init()` once we have the context + callbacks.
  protected runtime!: SpellRuntime;

  constructor() {
    this.registry = new SymbolRegistry();
    this.root = new SpellClip({ symbol: null, name: "root", parent: null });
    this.container = this.root.container;
  }

  init(
    context: SpellContext,
    callbacks: SpellCallbacks,
    textures: SpellTextureProvider
  ): void {
    this.runtime = new SpellRuntime({
      root: this.root,
      registry: this.registry,
      context,
      callbacks,
    });

    // Per-spell module registers its library symbols (compiled from
    // AS DefineSprite_N + clipEvent scripts).
    this.registerSymbols(textures, context);

    // Override each symbol's anchor with the texture provider's
    // actual rasterization data. Spell modules compute anchors from
    // the source-manifest bounds (e.g., 113.3×95.9), but Vello returns
    // tight per-frame bounds (e.g., 80×75) — using the manifest-derived
    // normalized anchor on a smaller texture mis-positions the sprite
    // off the registration point. The texture provider gives us the
    // pixel-space anchor + actual frame size; we recompute the
    // normalized anchor here to match the actual texture.
    this.applyTextureAnchors(textures);

    // Apply canonical displayType wiring: anchor, projectile motion,
    // initial attachMovie of "move" / "shoot" / etc.
    configureHarness({
      runtime: this.runtime,
      displayType: this.displayType,
      caster: { x: context.cellFrom.x, y: context.cellFrom.y },
      target: { x: context.cellTo.x, y: context.cellTo.y },
      level: context.level,
    });

    // Hook for the canonical SWF main-timeline frame_1 actions —
    // typically `SOMA.playSound(...); stop();` (e.g. spell 103's
    // "ronce", spell 909's "jet_903"). For spells whose outer SWF has
    // additional authored children placed on the main timeline (e.g.
    // spell 909's sprite_22 + sprite_41 running in parallel), the
    // override attaches those children here too — the harness has
    // already finished its displayType setup, so attached children
    // start ticking on the next runtime frame.
    this.onSpellStart(callbacks, context);

    // eslint-disable-next-line no-console
    console.log(
      `[RuntimeSpell ${this.spellId}] init done — displayType=${this.displayType}, ` +
        `caster=(${context.cellFrom.x.toFixed(0)},${context.cellFrom.y.toFixed(0)}), ` +
        `target=(${context.cellTo.x.toFixed(0)},${context.cellTo.y.toFixed(0)}), ` +
        `level=${context.level}, root.children=[${[...this.root.children.keys()].join(",")}]`
    );
  }

  /**
   * Per-spell symbol registration. Implement by registering each AS
   * `DefineSprite_*` symbol as a `SymbolDefinition` (with its frame
   * textures, frame-script Map, and onLoad/onEnterFrame handlers).
   */
  protected abstract registerSymbols(
    textures: SpellTextureProvider,
    context: SpellContext
  ): void;

  /**
   * Override to fire the canonical main-timeline `frame_1` script
   * (sounds + initial child attaches). Runs once after harness
   * configuration, before the first runtime tick. Default is a no-op.
   */
  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {}

  /**
   * Walk every symbol in the registry and rewrite its anchor in the
   * normalized [0,1] form Pixi expects, using the actual texture frame
   * dimensions instead of the manifest-declared bounds. This is the
   * source of `Pixi sprite.anchor.set(...)` in `SpellClip`.
   *
   * The texture provider returns:
   *   - frameWidth/Height: tight rendered frame in logical pixels
   *   - anchorPxX/Y: registration point in pixel offset within the
   *     frame (where the SWF "(0,0)" lands)
   *
   * Pixi normalized anchor = anchorPx / frame. Without this rewrite
   * the spell visual displays at the right size but with the pivot at
   * a different point inside the texture, which manifests as a sprite
   * that's offset from its target cell by ~half its bounds difference.
   */
  private applyTextureAnchors(textures: SpellTextureProvider): void {
    if (!textures.getAnimationInfo) {
      return;
    }
    for (const sym of this.registry.all()) {
      const info = textures.getAnimationInfo(sym.name);
      if (!info || info.frameWidth <= 0 || info.frameHeight <= 0) {
        continue;
      }
      // Mutate readonly fields via cast — `SymbolDefinition.anchorX/Y`
      // is structurally readonly to discourage accidental mid-tick
      // changes, but the runtime is allowed to correct anchors at
      // init time before any clip is constructed.
      const mut = sym as { -readonly [K in keyof typeof sym]: typeof sym[K] };
      mut.anchorX = info.anchorPxX / info.frameWidth;
      mut.anchorY = info.anchorPxY / info.frameHeight;
    }
  }

  update(deltaTime: number, _elapsedTime?: number): void {
    this.runtime.tick(deltaTime);
  }

  isComplete(): boolean {
    return this.runtime?.isComplete ?? false;
  }

  destroy(): void {
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }
}
