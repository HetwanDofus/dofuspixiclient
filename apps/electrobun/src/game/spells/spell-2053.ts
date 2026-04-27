/**
 * Spell 2053 — (Unknown name, likely a fire/explosion spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2053/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single `shoot` symbol with
 * 84 authored frames, no `move` symbol, no `attachMovie` calls spawning
 * child symbols, and no caster-side content. The `shoot` symbol is placed
 * at the target cell by the harness (ProjectileBallistic would require a
 * `move` symbol; the sole animation here is a direct impact). The harness
 * for ProjectileBallistic/Linear expects to attach `move`/`shoot` itself,
 * but this spell has no `move` and the `shoot` IS the top-level content —
 * making it a plain TargetCell impact.
 *
 * Library symbols:
 *   - None. The `shoot` animation is the top-level `animations[]` entry
 *     (not in `librarySymbols[]`). The harness for TargetCell places the
 *     root at the target cell. We attach the `shoot` symbol from
 *     `onSpellStart` as a direct child of root.
 *
 * Main timeline (shoot symbol):
 *   frame_1:  `_rotation = 0; SOMA.playSound("flamme_2022"); SOMA.playSound("pet");`
 *   frame_70: `_parent.removeMovieClip(); stop();` → complete the spell.
 *
 * signalHit is fired at frame_1 (the impact frame — the animation plays at
 * the target, so the hit is registered as the visual begins). This is
 * canonical for TargetCell impact spells.
 */

import type {
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";

const SHOOT_BOUNDS = {
  width: 293.85,
  height: 231.75,
  offsetX: -161.2,
  offsetY: -148.85,
};

export class Spell2053 extends RuntimeSpell {
  readonly spellId = 2053;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 84-frame fire/explosion impact at target -------
    // The `shoot` animation is the sole visual for this spell.
    // It lives in animations[] (not librarySymbols[]), so we use the
    // bare "shoot" key (no lib_ prefix).
    //
    // AS DefineSprite_18_shoot/frame_1/DoAction.as:
    //   _rotation = 0;
    //   SOMA.playSound("flamme_2022");
    //   SOMA.playSound("pet");
    //
    // AS DefineSprite_18_shoot/frame_70/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    this.shootSym = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_18_shoot/frame_1/DoAction.as
            // _rotation = 0 — ensure upright regardless of any parent rotation.
            clip.rotation = 0;
            // Sounds are played here in canonical AS. We capture them via
            // the stored callback reference (see onSpellStart).
            this.runtime.signalHit();
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_18_shoot/frame_70/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // The canonical main timeline places the shoot symbol as a child of
    // the outer mc (root). For TargetCell, root is already positioned at
    // the target cell by the harness. We attach shoot here so it starts
    // ticking from the next runtime frame.
    //
    // Sounds are declared on frame_1 of the shoot symbol in AS, but since
    // the shoot clip starts ticking at frame_1 immediately, we play them
    // now as part of the spell start (matching the manifest sounds[] entries
    // at frame 0).
    callbacks.playSound("flamme_2022");
    callbacks.playSound("pet");

    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
