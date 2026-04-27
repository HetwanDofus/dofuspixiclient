/**
 * Spell 910 — Flèche de Feu (Cra fire arrow impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/910/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` symbol
 * anchored at the target cell. There is no projectile motion (no `move`
 * symbol, no caster reference, no `_parent.cellFrom`/`cellTo` world-
 * absolute wiring). The `shoot` animation plays a full 84-frame impact
 * burst at the target, with:
 *
 *   - frame_1 (DoAction.as):   SOMA.playSound("explosion")
 *   - frame_1 (DoAction_2.as): _rotation = 0  (upright impact)
 *   - frame_70 (DoAction.as):  _parent.removeMovieClip(); stop()
 *
 * The harness attaches `shoot` at the target for displayType=20/21/30/31,
 * but for TargetCell (11) it does NOT attach any `shoot` automatically —
 * the spell's onSpellStart must attach it directly to the root.
 *
 * Library symbols: none (manifest.librarySymbols is absent/empty).
 * The `shoot` animation lives in manifest.animations[] only, so its
 * texture key has NO `lib_` prefix.
 *
 * Main timeline: the outer SWF main timeline has no authored frame
 * scripts; the single `shoot` symbol is placed on-stage at frame 1.
 * We attach it from onSpellStart.
 *
 * signalHit: fired at frame_70 (index 69), immediately before the
 * spell completes, matching the canonical impact frame.
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
  width: 205.1,
  height: 133.45,
  offsetX: -102.5,
  offsetY: -71.85,
};

export class Spell910 extends RuntimeSpell {
  readonly spellId = 910;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 84-frame impact animation at target cell --------
    // No librarySymbols entry in manifest; textures live under bare
    // "shoot" key (no lib_ prefix).
    //
    // AS DefineSprite_15_shoot/frame_1/DoAction.as:
    //   SOMA.playSound("explosion");
    //
    // AS DefineSprite_15_shoot/frame_1/DoAction_2.as:
    //   _rotation = 0;
    //
    // AS DefineSprite_15_shoot/frame_70/DoAction.as:
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
          (clip) => {
            // AS DefineSprite_15_shoot/frame_1/DoAction.as
            // SOMA.playSound("explosion") — sound is played via onSpellStart
            // for the initial attach; this script also resets rotation per
            // DoAction_2.as: _rotation = 0.
            // AS DefineSprite_15_shoot/frame_1/DoAction_2.as
            clip.rotation = 0;
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_15_shoot/frame_70/DoAction.as
            // _parent.removeMovieClip(); stop();
            this.runtime.signalHit();
            clip.parent?.remove();
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
    // AS DefineSprite_15_shoot/frame_1/DoAction.as: SOMA.playSound("explosion")
    callbacks.playSound("explosion");

    // The shoot symbol is placed on the main timeline at frame 1 (depth 1).
    // For TargetCell the harness has already anchored the container at
    // the target cell, so attaching at (0, 0) places the impact there.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
