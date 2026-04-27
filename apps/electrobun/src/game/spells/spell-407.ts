/**
 * Spell 407 — Explosion (impact animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/407/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbol — this is a single impact animation
 * that plays at the target cell. The main timeline places one child (anim1)
 * and plays a sound.
 *
 * Canonical AS layout:
 *   - frame_1/DoAction.as: SOMA.playSound("explosion")
 *   - DefineSprite_6 (anim1 outer container, 96 frames):
 *       frame_1: _rotation = -40 - random(100); t = random(50)+30;
 *                _xscale = _yscale = t;
 *       frame_52: stop();
 *   - DefineSprite_7 (inner animated sprite, 94 frames):
 *       frame_94: _parent.removeMovieClip() → triggers spell complete
 *
 * The manifest has a single `animations` entry ("anim1", 96 frames) and
 * no `librarySymbols` — so textures are fetched with the bare key "anim1"
 * (no "lib_" prefix). DefineSprite_6 wraps DefineSprite_7; both are modelled
 * as SymbolDefinitions. DefineSprite_7 is the inner 94-frame animated sprite
 * whose frame_94 removes its parent (DefineSprite_6), which in turn completes
 * the spell.
 *
 * signalHit: fired at frame_1 of DefineSprite_6 (the impact moment, when the
 * rotation/scale are set and the visual begins).
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

const ANIM1_BOUNDS = {
  width: 204.95,
  height: 85.55,
  offsetX: -44.05,
  offsetY: -85.55,
};

export class Spell407 extends RuntimeSpell {
  readonly spellId = 407;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- DefineSprite_7 — inner 94-frame animated burst ----------
    // AS DefineSprite_7/frame_94/DoAction.as:
    //   _parent.removeMovieClip();
    // This is the actual visual content (the explosion frames). It lives
    // inside DefineSprite_6. At frame 94 it removes its parent (the outer
    // container), which completes the spell.
    const innerSpriteSym: SymbolDefinition = {
      name: "innerSprite",
      totalFrames: 94,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          93,
          (clip) => {
            // AS DefineSprite_7/frame_94/DoAction.as: _parent.removeMovieClip()
            // Remove the parent container (DefineSprite_6 / anim1Sym).
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_6 — outer 96-frame container ---------------
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   _rotation = -40 - random(100);
    //   t = random(50) + 30;
    //   _xscale = t;
    //   _yscale = t;
    // AS DefineSprite_6/frame_52/DoAction.as:
    //   stop();
    // On frame_1 the container is randomly rotated and scaled; then at
    // frame_52 it stops (the inner sprite's own timeline continues to
    // drive the visual via its own playback up to frame_94 where it
    // removes this container).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 96,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_6/frame_1/DoAction.as
            const rotDeg = -40 - Math.floor(Math.random() * 100);
            clip.rotation = (rotDeg * Math.PI) / 180;
            const t = Math.floor(Math.random() * 50) + 30;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // Attach the inner animated sprite at depth 1.
            clip.attach(innerSpriteSym, "innerSprite", 1, ctx);
            // signalHit at impact moment (frame_1 of the container).
            this.runtime.signalHit();
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_6/frame_52/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(innerSpriteSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("explosion")
    callbacks.playSound("explosion");
    // Attach the outer container (DefineSprite_6) at the root.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
