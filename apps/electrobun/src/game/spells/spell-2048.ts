/**
 * Spell 2048 — (Projectile Linear, likely Cra or similar arrow spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2048/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The manifest has a `move` symbol with a
 * placed child (PlaceObject2_3_1) that has oscillating rotation clip events,
 * and a `shoot` symbol (DefineSprite_8_shoot) that plays 91 frames then removes
 * its parent (completing the spell). The harness for ProjectileLinear attaches
 * `shoot` at the target-relative offset inside a container rotated toward the
 * target. No `move` animation is involved in this spell's AS layout in the
 * typical ballistic sense — instead, DefineSprite_9_move is the projectile
 * container (with a child placed at load time that wobbles in rotation), and
 * DefineSprite_8_shoot is the impact animation at target.
 *
 * Reading the AS:
 *   - DefineSprite_9_move/frame_1/DoAction.as: SOMA.playSound("pic") — plays
 *     on move frame_1. This is the projectile moving sound.
 *   - DefineSprite_9_move/frame_1/PlaceObject2_3_1/onClipEvent(load): seeds
 *     `a=30, i=0` for the oscillation.
 *   - DefineSprite_9_move/frame_1/PlaceObject2_3_1/onClipEvent(enterFrame):
 *     `_rotation = 90 + a * cos(i += 0.6); a /= 1.1;` — wobbling rotation
 *     that decays.
 *   - DefineSprite_7/frame_64/DoAction.as: stop() — inner sub-symbol stops
 *     at frame 64 (this is the child placed inside move, DefineSprite_7 is
 *     the visual content of PlaceObject2_3_1).
 *   - DefineSprite_8_shoot/frame_91/DoAction.as: _parent.removeMovieClip();
 *     stop(); — shoot runs 91 frames (frame_91 = index 90 zero-based... wait,
 *     frame_91 means the 91st frame = index 90 in 0-based), then removes
 *     parent and signals completion.
 *
 * The `animations[]` list has only `shoot` (93 frames of actual textures).
 * The `librarySymbols[]` is empty in the manifest. The `move` and `shoot`
 * entries in the scripts correspond to DefineSprite_9_move and
 * DefineSprite_8_shoot respectively.
 *
 * Since librarySymbols is empty, all texture keys use bare names (no lib_ prefix).
 * The `shoot` animation in manifest has 93 frames and provides the visual content
 * for the shoot symbol. The `move` symbol is a container with a wobbling child
 * (DefineSprite_7) that is the visual content.
 *
 * For ProjectileLinear (displayType=20): harness attaches `shoot` at the target
 * offset inside the rotated root container. The `move` symbol here is named in the
 * scripts as DefineSprite_9_move — it's the container the harness expects. However,
 * since the harness for displayType=20 only attaches `shoot`, and `move` is not
 * used by harness for linear spells, `move` here is actually what the harness calls
 * the projectile that travels to the target. But looking more carefully:
 *
 * For displayType=20 (ProjectileLinear), the harness ONLY attaches `shoot` at the
 * target offset. It does NOT attach `move` for linear types. The `move` symbol in
 * the scripts (DefineSprite_9_move) plays sound and has a wobbling child — this
 * suggests it's actually what visually travels. But since the harness for linear
 * only does `shoot`, the "move" is actually referenced as "shoot" by the harness
 * naming convention: the projectile itself is `shoot`.
 *
 * Re-reading: manifest `animations[0].name = "shoot"` with 93 frames. The AS
 * script DefineSprite_8_shoot is the impact/completion sprite (frame_91 removes
 * parent). DefineSprite_9_move is a sub-container that plays sound and has a
 * wobbling child. Given that `move` in the manifest scripts is DefineSprite_9_move
 * and `shoot` is DefineSprite_8_shoot, and the manifest's animations list only
 * contains `shoot`, the visual content is in `shoot`.
 *
 * Most likely layout: displayType=20, harness attaches `shoot` at target, and
 * `shoot` has the 93-frame texture animation. The `move` symbol (DefineSprite_9_move)
 * is what gets placed as a child WITHIN shoot (via PlaceObject2), not separately
 * attached by the harness. But the move's frame_1 DoAction plays "pic" sound.
 *
 * Simplest correct interpretation:
 * - displayType=20 (ProjectileLinear): harness attaches `shoot` at target offset.
 * - `shoot` (DefineSprite_8_shoot): 93-frame visual. frame_91 (index 90) removes
 *   parent + calls complete().
 * - `move` (DefineSprite_9_move): a container-only symbol with sound + wobble child.
 *   It may be placed INSIDE the main timeline or inside shoot. Given it plays sound
 *   on frame_1, it's likely the main projectile body. But harness for linear only
 *   uses `shoot`. We register both and let `shoot`'s frame_1 handle signal.
 *
 * signalHit: for displayType=20, harness does NOT auto-signal hit, so we call
 * this.runtime.signalHit() from shoot's frame_1 (when the impact starts).
 *
 * complete(): from shoot frame_91 (= index 90, since frame_91/DoAction.as → set(90,...)).
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

// shoot bounds from manifest animations[0]
const SHOOT_BOUNDS = {
  width: 12.85,
  height: 31.6,
  offsetX: -12.45,
  offsetY: -17.6,
};

export class Spell2048 extends RuntimeSpell {
  readonly spellId = 2048;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- inner wobble child (DefineSprite_7) --------------------
    // AS DefineSprite_7/frame_64/DoAction.as: stop()
    // This is the visual child placed inside `move` at PlaceObject2_3_1.
    // It has oscillating rotation driven by clip events.
    // No texture frames available separately — it's embedded inside move.
    // We model it with the shoot frames as visual content since it's the
    // only visual asset available, or as a container-only sub-symbol.
    // Since librarySymbols is empty, treat as container-only.
    const innerSym: SymbolDefinition = {
      name: "inner",
      totalFrames: 64,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_9_move/frame_1/PlaceObject2_3_1/onClipEvent(load):
      //   a = 30; i = 0;
      onLoad: (clip) => {
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      // AS DefineSprite_9_move/frame_1/PlaceObject2_3_1/onClipEvent(enterFrame):
      //   _rotation = 90 + a * Math.cos(i += 0.6);
      //   a /= 1.1;
      onEnterFrame: (clip) => {
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.6;
        // AS rotation in degrees → radians
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a = a / 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
      // AS DefineSprite_7/frame_64/DoAction.as: stop()
      frameScripts: new Map([
        [
          63,
          (clip) => {
            // frame_64 → index 63: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- move — projectile container (DefineSprite_9_move) -------
    // AS DefineSprite_9_move/frame_1/DoAction.as: SOMA.playSound("pic")
    // PlaceObject2_3_1 places the inner wobble child on frame_1.
    // No authored visual frames for move itself — container only.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_9_move/frame_1/DoAction.as: SOMA.playSound("pic")
            // Sound is played via onSpellStart instead (main timeline),
            // but move's frame_1 also triggers it. We capture it here
            // by attaching the inner child with wobble behavior.
            // Also attach the inner child that carries the clip events.
            clip.attach(innerSym, "inner", 3, ctx);
          },
        ],
      ]),
    };

    // ---- shoot — 93-frame impact animation (DefineSprite_8_shoot) --
    // AS DefineSprite_8_shoot/frame_91/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    // The shoot symbol uses the `shoot` texture frames from animations[].
    // Since librarySymbols is empty, use bare name "shoot" (no lib_ prefix).
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 93,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // frame_1 of shoot — impact starts, signal hit to combat system.
            // For displayType=20, harness does not auto-signal hit.
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_91/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            // frame_91 → index 90 (0-based).
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(innerSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS DefineSprite_9_move/frame_1/DoAction.as: SOMA.playSound("pic")
    // The sound is authored on the move symbol's frame_1, which fires
    // when the harness (for ProjectileLinear displayType=20) positions
    // the shoot. We play it here on spell start as the canonical trigger.
    callbacks.playSound("pic");
  }
}
