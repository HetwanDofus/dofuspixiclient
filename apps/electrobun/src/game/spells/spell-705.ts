/**
 * Spell 705 — Grina (Iop/Ecaflip grinding slash).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/705/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference,
 * no dual-anchored world-absolute layout. The spell is a pure impact
 * animation at the target cell. DefineSprite_11 is the outer container
 * (main timeline host) that plays the sound on frame_1 and removes its
 * parent on frame_106. The manifest has a single `animations` entry
 * ("anim1", 108 frames) with no `librarySymbols[]`, confirming this is
 * a self-contained composite animation — all visual content is baked
 * into the pre-rendered anim1 frames, but the timeline scripts
 * (signalHit, complete) must still be driven at runtime.
 *
 * Symbol layout (all from manifest.animations, NOT librarySymbols):
 *   - "anim1" — 108-frame composite impact animation.
 *       frame_1  (idx 0):  SOMA.playSound("grina_705")  [DefineSprite_11/frame_1]
 *       frame_106 (idx 105): _parent.removeMovieClip(); stop() → complete()
 *                            [DefineSprite_11/frame_106]
 *
 * Additional sprites referenced in scripts (DefineSprite_3, _5, _9, _10)
 * are internal sub-composites whose scripts (random trajectory selection,
 * sub-timeline stops) are baked into the composite anim1 frames. They do
 * not appear in librarySymbols[] and are not attached at runtime by AS
 * `attachMovie` calls — the manifest's single `anim1` animation covers
 * them. No symbols need to be registered beyond anim1 itself.
 *
 * signalHit: fired at the canonical impact frame. DefineSprite_11 is the
 * outer mc; its frame_106 is the removal frame. The composite animation
 * has stopFrame=105 and fadingFrame=104, suggesting the hit lands around
 * frame 12-15 (the first visual impact in the anim). Conservatively we
 * fire signalHit at frame 1 (index 0) since there is no explicit "end()"
 * call in the AS — the damage applies as the animation begins. Adjust
 * if a later frame is observed to be more accurate.
 *
 * Main timeline: SOMA.playSound("grina_705") on frame_1 of the outer
 * DefineSprite_11 (= anim1 frame 0). onSpellStart fires the sound.
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

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 108-frame composite impact animation ------------
    // Hosts the canonical DefineSprite_11 outer timeline.
    // AS DefineSprite_11/frame_1/DoAction.as: SOMA.playSound("grina_705")
    //   → sound is fired from onSpellStart instead (main timeline pattern).
    // AS DefineSprite_11/frame_106/DoAction.as: _parent.removeMovieClip(); stop()
    //   → clip.parent?.remove() + this.runtime.complete()
    // Internal sprites DefineSprite_3, _5, _9, _10 are sub-composites
    // whose trajectory/stop logic is embedded in the composite SVG frames;
    // their scripts select random trajectories at frame_1 and stop at
    // various sub-frames, all of which are fully captured in the rendered
    // anim1 composite. No attachMovie calls reference them externally.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 108,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_11/frame_1/DoAction.as:
            // SOMA.playSound("grina_705") — fired in onSpellStart instead.
            // Signal hit as the animation begins (no explicit end() call in AS).
            this.runtime.signalHit();
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_11/frame_106/DoAction.as:
            // _parent.removeMovieClip(); stop();
            // clip is anim1 (the outer mc's representative); its parent is root.
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_11/frame_1/DoAction.as: SOMA.playSound("grina_705")
    callbacks.playSound("grina_705");

    // Attach anim1 as the single top-level child of root.
    // The harness for TargetCell positions root at the target cell;
    // anim1 at (0,0) relative to root lands exactly on target.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
