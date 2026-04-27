/**
 * Spell 705 — Grinaspic (unknown class, likely Sadida or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/705/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`/`shoot`/`duplicate` symbol,
 * no caster-side reference, no dual-anchor pattern. The spell is a single
 * impact animation anchored at the target cell. The `anim1` animation in
 * manifest.json is the only top-level content; `librarySymbols` is empty so
 * there is no `lib_` prefix anywhere.
 *
 * AS layout:
 *   - DefineSprite_11 — outer container, 106+ frames.
 *       frame_1:  SOMA.playSound("grina_705").
 *       frame_106: _parent.removeMovieClip(); stop() — spell complete.
 *   - DefineSprite_5 — sub-sprite with 3 trajectory labels (traj1).
 *       frame_1:  random(2) branch — all three branches call
 *                 gotoAndStop("traj1"); play() (all identical).
 *       frame_58: stop().
 *       frame_118: stop().
 *       frame_178: stop().
 *   - DefineSprite_3 — small randomised sub-sprite.
 *       frame_1: gotoAndStop(random(3) + 1).
 *   - DefineSprite_9 — brief sub-composite.
 *       frame_103: this.removeMovieClip().
 *   - DefineSprite_10 — another sub-composite.
 *       frame_49: stop().
 *
 * The manifest has no librarySymbols[]; the entire animation is authored
 * into the composite `anim1` timeline (108 frames). signalHit is fired at
 * the canonical impact moment — we use frame 12 (approximately 1/9 of the
 * way through, conventional for this pattern), but since the AS source does
 * not call `this.end()` explicitly the clearest canonical choice is the
 * moment the sound fires (frame_1 = index 0) for instant spells; here we
 * use a mid-animation frame consistent with the visual impact. The safest
 * canonical mapping given the absence of an explicit `end()` call is frame
 * index 0 (impact starts immediately). complete() fires at frame 105
 * (AS frame_106: _parent.removeMovieClip()).
 *
 * Main timeline (implicit): places the DefineSprite_11 composite which
 * in turn plays the full animation. We model the whole thing as a single
 * `anim1` symbol whose frameScripts replicate the nested sprite behaviours
 * at the correct absolute frame indices within the composite.
 *
 * Because `librarySymbols` is empty and the animation is a flat composite,
 * we register a single `anim1` symbol with the full 108-frame texture array
 * and embed all frame-script logic there.
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
  width: 391.25,
  height: 262.15,
  offsetX: -207.6,
  offsetY: -224.8,
};

export class Spell705 extends RuntimeSpell {
  readonly spellId = 705;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite impact animation at target cell ------
    // This is the sole content of the spell. The manifest has no
    // librarySymbols[], so we use the bare name "anim1" (no lib_ prefix)
    // and textures.getFrames("anim1").
    //
    // Nested sprite behaviours are folded into frameScripts at the
    // absolute composite frame indices:
    //
    //   frame_1   (index 0):  DefineSprite_11/frame_1 — sound already
    //                         handled in onSpellStart; no additional action.
    //   frame_3   (index 2):  DefineSprite_3/frame_1 — gotoAndStop(random(3)+1)
    //                         is internal randomisation within the composite;
    //                         the composite texture already bakes a single
    //                         branch visually, so no runtime action needed.
    //   frame_5   (index 4):  DefineSprite_5/frame_1 — all branches lead to
    //                         gotoAndStop("traj1"); play() — effectively a
    //                         no-op for the composite (already playing).
    //   Approximate hit frame (index 0): signalHit fires immediately because
    //                         the impact visual begins on frame 1.
    //   frame_106 (index 105): DefineSprite_11/frame_106 —
    //                         _parent.removeMovieClip(); stop() → complete().
    //
    // DefineSprite_9/frame_103 (self-remove) and
    // DefineSprite_10/frame_49 (stop) are internal sub-sprite signals
    // that do not affect the outer timeline; the composite textures
    // handle them visually already.

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 108,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_11/frame_1/DoAction.as — sound fired in
          // onSpellStart; signal hit immediately as the impact begins.
          0,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_11/frame_106/DoAction.as:
          //   _parent.removeMovieClip(); stop();
          // frame_106 in AS → index 105 here.
          105,
          (clip) => {
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
    context: SpellContext,
  ): void {
    // AS DefineSprite_11/frame_1/DoAction.as: SOMA.playSound("grina_705");
    callbacks.playSound("grina_705");

    // Attach the composite anim1 at depth 1 on the root — mirrors the
    // implicit main-timeline placement of DefineSprite_11 at frame_1.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
