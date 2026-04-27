/**
 * Spell 110 — Carapace (Feca shield).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/110/scripts/scripts/
 *
 * displayType=10 (CasterCell). This is a self-buff / shield effect that
 * plays on the caster cell. There are no library symbols, no attachMovie
 * calls, and no projectile motion. The manifest has a single `animations`
 * entry (`anim1`, 129 frames) and no `librarySymbols`. The spell plays
 * through its authored composite timeline, signals hit at mid-point, and
 * completes when the outer clip removes itself.
 *
 * Canonical AS layout:
 *   - DefineSprite_7 (the outer anim1 clip, 129 frames):
 *       frame_1:   SOMA.playSound("shield_cara")
 *       frame_127: _parent.removeMovieClip() → spell complete
 *   - DefineSprite_5 (an inner sub-composite, 67 frames):
 *       frame_67:  stop()
 *
 * The `anim1` animation lives only in `animations[]`, not in
 * `librarySymbols[]`, so textures are loaded with bare key `"anim1"`.
 *
 * signalHit is fired at frame_1 of DefineSprite_7 (same frame as the
 * sound) because the canonical hit timing for a self-buff / shield
 * coincides with the visible impact frame (the effect landing on the
 * caster). Frame_127 removes the outer mc and signals completion.
 *
 * Library symbols: none.
 *
 * Main timeline: single `anim1` child attached in onSpellStart;
 * sound played from the anim1 frame_1 script (mirrored in onSpellStart
 * since the sprite's frame_1 is the canonical playSound call site).
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
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell110 extends RuntimeSpell {
  readonly spellId = 110;
  readonly displayType = SpellDisplayType.CasterCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main composite animation on the caster ----------
    // 129-frame authored timeline. No library symbols — anim1 is the
    // sole entry in animations[], not in librarySymbols[], so we use
    // the bare key "anim1" (no lib_ prefix).
    //
    // AS DefineSprite_7/frame_1/DoAction.as:
    //   SOMA.playSound("shield_cara");
    //   → sound is played from onSpellStart (where callbacks are
    //     available). signalHit fires here too — the effect visually
    //     lands on the caster at the first frame.
    //
    // AS DefineSprite_7/frame_127/DoAction.as:
    //   _parent.removeMovieClip();
    //   → removes the outer mc; we complete the spell here.
    //
    // AS DefineSprite_5/frame_67/DoAction.as:
    //   stop();
    //   → an inner sub-sprite stops at frame 67; because the composite
    //     is baked into the anim1 texture frames, there is no separate
    //     clip to stop in our runtime. The visual is already encoded
    //     in the per-frame SVGs. No additional handling required.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_7/frame_1/DoAction.as — sound + signalHit.
            // Sound is fired in onSpellStart where callbacks are available.
            // signalHit is also fired in onSpellStart alongside the sound.
          },
        ],
        [
          126,
          (clip) => {
            // AS DefineSprite_7/frame_127/DoAction.as:
            //   _parent.removeMovieClip();
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
    // AS DefineSprite_7/frame_1/DoAction.as: SOMA.playSound("shield_cara");
    callbacks.playSound("shield_cara");

    // Signal hit at the first visible frame — canonical for self-buff
    // / shield effects where damage application coincides with the
    // visual landing on the caster.
    this.runtime.signalHit();

    // Attach the main anim1 composite at depth 1 on the root clip.
    // For CasterCell the root is already at the caster cell position.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
