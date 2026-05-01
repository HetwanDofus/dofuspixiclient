/**
 * Spell 1011 — (Unknown name, likely a Feca/Eniripsa buff or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1011/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile (`move`/`shoot`),
 * no caster-anchoring, no dual-timeline, no `duplicate`. The spell is a
 * single composite animation (`anim1`, 72 frames) placed at the target
 * cell. This is the classic "impact at target" pattern.
 *
 * The manifest has NO `librarySymbols[]` array — all symbols are listed
 * only under `animations[]`. Therefore NO `lib_` prefix is used anywhere.
 *
 * Sprite hierarchy (from the script paths):
 *   - DefineSprite_4  — randomised-scale/rotation child, stops at frame 19.
 *                       frame_1: set random t ∈ [100,200], _xscale/_yscale = t,
 *                                _rotation = random(360) degrees.
 *                       frame_19: stop().
 *   - DefineSprite_7  — animated child, stops at frame 46.
 *                       frame_46: stop().
 *   - DefineSprite_9  — animated child, stops at frame 64.
 *                       frame_64: stop().
 *   - DefineSprite_10 — outer container / sequencer (72 frames in anim1).
 *                       frame_10: this.end() → signalHit.
 *                       frame_70: stop(); _parent.removeMovieClip() → complete.
 *
 * The main SWF timeline (frame_1/DoAction.as) plays the sound "pet" and
 * implicitly places the anim1 composite content (which is DefineSprite_10).
 * We model this by registering `anim1` as the top-level symbol and attaching
 * it from `onSpellStart`. The inner sprites (4, 7, 9) are components whose
 * frame textures are baked into the composite `anim1` frames. Since the
 * manifest only exposes `anim1` as a single composite animation with no
 * separate lib_ entries for sprites 4/7/9, we model DefineSprite_10 as a
 * single symbol wrapping the `anim1` texture frames, with the canonical
 * frameScripts driving hit/complete.
 *
 * DefineSprite_4's frame_1 randomises scale and rotation — those are live
 * runtime values. Because sprites 4, 7, 9 appear to be authored children
 * placed on DefineSprite_10's timeline and the manifest exports a single
 * composite `anim1`, we model the randomisation from DefineSprite_4/frame_1
 * inside the anim1 symbol's onLoad, applied to the clip itself. The stop()
 * calls on sprites 7 (frame 46) and 9 (frame 64) are inner-timeline halts
 * that are baked into the composite rendering — they don't affect the outer
 * DefineSprite_10 timeline's progression.
 *
 * Main timeline: SOMA.playSound("pet") at frame_1. No explicit stop().
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
  width: 205.7,
  height: 109.85,
  offsetX: -103.3,
  offsetY: -56.6,
};

export class Spell1011 extends RuntimeSpell {
  readonly spellId = 1011;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite 72-frame impact animation -------------
    // Models the outer DefineSprite_10 timeline (which is what drives
    // signalHit and completion). Inner sprites 4/7/9 are composited
    // into the per-frame SVG textures by the exporter.
    //
    // frame_1/DoAction:  random scale + rotation (DefineSprite_4/frame_1).
    //   AS: t = 100 + random(100); _xscale = t; _yscale = t;
    //       _rotation = random(360);
    //
    // frame_10/DoAction: this.end() → signalHit.
    //   AS: DefineSprite_10/frame_10/DoAction.as
    //
    // frame_70/DoAction: stop(); _parent.removeMovieClip().
    //   AS: DefineSprite_10/frame_70/DoAction.as

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 72,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_4/frame_1/DoAction.as
        // t = 100 + random(100);
        // _xscale = t; _yscale = t; _rotation = random(360);
        const t = 100 + Math.floor(Math.random() * 100);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },

      frameScripts: new Map([
        [
          9,
          (_clip) => {
            // AS: DefineSprite_10/frame_10/DoAction.as
            // this.end() → signal that the spell has hit the target.
            this.runtime.signalHit();
          },
        ],
        [
          69,
          (clip) => {
            // AS: DefineSprite_10/frame_70/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_1/DoAction.as — SOMA.playSound("pet");
    callbacks.playSound("pet");

    // Attach the main composite animation at root depth 1.
    // Mirrors the implicit PlaceObject of the main-timeline sprite.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
