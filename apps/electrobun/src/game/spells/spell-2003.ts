/**
 * Spell 2003 — (Unknown name, likely a simple impact/buff animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2003/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no library symbols, no `attachMovie`
 * calls, no `move`/`shoot`/`duplicate` symbols, and no caster-reference logic.
 * The manifest has a single `animations` entry (`anim1`, 54 frames) that plays
 * directly at the target cell. The only script is:
 *
 *   DefineSprite_2/frame_52/DoAction.as → `_parent.removeMovieClip();`
 *
 * which maps to frame index 51 (0-based) of the `anim1` symbol. Since this
 * `_parent.removeMovieClip()` removes the outer mc, we call
 * `this.runtime.complete()` there. We also call `this.runtime.signalHit()` on
 * the first frame (frame 0) because the impact is instantaneous — there is no
 * projectile and no authored "hit frame" separate from the start of the
 * animation.
 *
 * Library symbols: none (librarySymbols is absent / empty in the manifest).
 *
 * Main timeline: single `anim1` animation attached as the root content.
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
  width: 118.3,
  height: 27.15,
  offsetX: 15.15,
  offsetY: -14,
};

export class Spell2003 extends RuntimeSpell {
  readonly spellId = 2003;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 54-frame impact animation at target cell --------
    // No librarySymbols in manifest; anim1 appears only in animations[].
    // textures key is bare "anim1" (no lib_ prefix).
    //
    // AS DefineSprite_2/frame_52/DoAction.as:
    //   _parent.removeMovieClip();
    // → frameScripts.set(51, ...) — signals completion and removes outer mc.
    //
    // signalHit fires at frame 0 (first frame of impact) since this is a
    // purely visual impact with no separate "hit moment" authored in the AS.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 54,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // First frame of the impact animation — signal hit immediately.
            this.runtime.signalHit();
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_2/frame_52/DoAction.as:
            //   _parent.removeMovieClip();
            // This is the outer mc removal — signal spell completion.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline: no SOMA.playSound present in the manifest scripts.
    // Attach anim1 as the root content so it starts ticking immediately.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
