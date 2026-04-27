/**
 * Spell 2019 — (Projectile, likely a Cra/nature arrow or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2019/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The manifest has both `move` and `shoot`
 * animations, and the shoot symbol (DefineSprite_15_shoot) has a frame_4 script
 * that does `_rotation = 0` — the canonical pattern for ballistic projectiles where
 * the impact sprite resets the velocity-angle rotation. The harness drives `move`
 * along a parabolic arc to target, attaches `shoot` on landing, and calls
 * signalHit() automatically. We must NOT call signalHit() ourselves.
 *
 * Library symbols (from AS scripts):
 *   - DefineSprite_8 — appears to be a particle/grass effect (no attachMovie name
 *     found; based on manifest it maps to an animation inside `shoot`). frame_1
 *     randomly jumps to frame 60 (4 in 5 chance) or stays; frame_34 stops. This
 *     is an internal sub-sprite of the shoot composite.
 *   - DefineSprite_12 — internal sub-sprite of shoot composite. frame_1 seeds
 *     random start frame, alpha, and scale. frame_97 stops.
 *   - DefineSprite_14 — internal sub-sprite (295 frames, stops at 295).
 *   - DefineSprite_15_shoot — the top-level `shoot` symbol (108 frames). frame_4
 *     resets rotation to 0. frame_106 calls _parent.removeMovieClip() + stop().
 *
 * The manifest has no `librarySymbols[]` entries — all symbols appear only in
 * `animations[]` as `shoot` (108 frames) and `move` (4 frames). The AS scripts
 * for DefineSprite_8, DefineSprite_12, and DefineSprite_14 describe internal
 * sub-sprites baked into the `shoot` composite animation; they are not separately
 * attachMovie'd by spell code — they are part of the authored `shoot` timeline.
 * So we register `move` and `shoot` as container/animated symbols using their
 * bare animation names (no lib_ prefix), which is correct since they only appear
 * in animations[], not librarySymbols[].
 *
 * Main timeline: SOMA.playSound("herbe"); (no stop — harness drives everything)
 *
 * Completion: shoot frame_106 → _parent.removeMovieClip() → runtime.complete().
 * Hit: harness signals automatically on ballistic landing (displayType 30).
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
  width: 63.6,
  height: 30.2,
  offsetX: -31.8,
  offsetY: -14.75,
};

const MOVE_BOUNDS = {
  width: 15.5,
  height: 5.3,
  offsetX: -9.7,
  offsetY: -2.7,
};

export class Spell2019 extends RuntimeSpell {
  readonly spellId = 2019;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);

    // ---- move — 4-frame animated projectile in flight ------------
    // No AS frame scripts on move itself. The harness attaches it at
    // root (0,0) and drives it along the parabolic arc. The animation
    // loops over its 4 frames for the visual of a spinning/moving
    // projectile during flight.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 4,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
    };

    // ---- shoot — 108-frame impact animation ----------------------
    // AS DefineSprite_15_shoot/frame_4/DoAction.as:
    //   _rotation = 0;
    // Resets the velocity-angle rotation applied by the harness so the
    // impact sprite displays upright (canonical ballistic pattern).
    //
    // AS DefineSprite_15_shoot/frame_106/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    // Removes the outer mc and ends the spell.
    //
    // DefineSprite_8, DefineSprite_12, and DefineSprite_14 are internal
    // sub-sprites baked into the shoot composite animation timeline;
    // their frame scripts drive randomised internal playback and are
    // encoded in the composite SVG frames — they are not separately
    // attachMovie'd. We express only the top-level shoot frame scripts
    // here (frame_4 and frame_106).
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 108,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_15_shoot/frame_4/DoAction.as: _rotation = 0;
          // Frame index 3 (0-based for AS frame_4).
          3,
          (clip) => {
            clip.rotation = 0;
          },
        ],
        [
          // AS DefineSprite_15_shoot/frame_106/DoAction.as:
          //   _parent.removeMovieClip(); stop();
          // Frame index 105 (0-based for AS frame_106).
          105,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("herbe");
    callbacks.playSound("herbe");
  }
}
