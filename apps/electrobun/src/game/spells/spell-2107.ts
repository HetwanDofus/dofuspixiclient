/**
 * Spell 2107 — Artillerie (Feca).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2107/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no `move`/`shoot`/`duplicate`
 * projectile symbols and no caster-side reference in its AS — it is a
 * single impact animation anchored at the target cell. The manifest has no
 * `librarySymbols[]` array; all content is driven by the single `animations`
 * entry `anim1` (51 frames). The main timeline `frame_1` plays a sound and
 * the outer mc removes itself at `frame_172` (triggering spell completion).
 *
 * The AS scripts reference many DefineSprite_N symbols (DefineSprite_7,
 * DefineSprite_9, DefineSprite_10_tige, DefineSprite_14, DefineSprite_15,
 * DefineSprite_17_baton2, DefineSprite_18_baton, DefineSprite_22,
 * DefineSprite_23, DefineSprite_24). These are all internal authored
 * timelines baked into the composite `anim1` animation — they are NOT
 * separately `attachMovie`-able library symbols (no `librarySymbols[]` in
 * manifest). The visual content for all of them is already composited into
 * the per-frame SVGs exported as `anim1`.
 *
 * The only runtime logic we need to preserve is:
 *   - `frame_1/DoAction.as`: SOMA.playSound("arty_102")
 *   - `frame_172/DoAction.as`: this.removeMovieClip() → complete()
 *   - signalHit: fired at frame 35 (the first canonical "impact" frame,
 *     where DefineSprite_7/frame_35 does gotoAndPlay — indicating the
 *     impact burst starts there).
 *
 * Library symbols: none (no librarySymbols[] in manifest).
 *
 * Main timeline:
 *   frame_1:  SOMA.playSound("arty_102")
 *   frame_172: this.removeMovieClip() → runtime.complete()
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
  width: 138.55,
  height: 91.55,
  offsetX: -70.4,
  offsetY: -73.5,
};

export class Spell2107 extends RuntimeSpell {
  readonly spellId = 2107;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // The manifest has no librarySymbols[] — all visual content is baked
    // into the composite `anim1` animation (51 frames of SVG). We register
    // it as the single symbol for this spell's root content.
    //
    // The outer SWF main timeline has 172 frames; the `anim1` asset covers
    // the visual portion (51 frames). The spell is considered "done" when
    // the main timeline reaches frame 172.
    //
    // We model the outer timeline as this symbol's frame scripts:
    //   - frame 34 (AS frame_35): canonical impact moment — signalHit
    //   - frame 171 (AS frame_172): this.removeMovieClip() → complete()
    //
    // The `anim1` asset has stopFrame=48 per manifest (0-based: frame 48).
    // We use totalFrames=172 to match the outer SWF timeline length, but
    // the visual sprite will cycle through the 51 anim1 frames and hold.

    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");

    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      // Match the outer SWF main-timeline length so frame scripts fire
      // at the canonical frames (AS frame_172 = index 171).
      totalFrames: 172,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS frame_35: DefineSprite_7/frame_35/DoAction.as
          // gotoAndPlay(random(5) + 17) — this is the impact burst start.
          // We use this frame as the canonical signalHit moment.
          34,
          (_clip, _ctx) => {
            // AS DefineSprite_7/frame_35/DoAction.as: gotoAndPlay(random(5) + 17)
            // This fires inside the impact sprite at frame 35 — canonical hit.
            this.runtime.signalHit();
          },
        ],
        [
          // AS frame_172/DoAction.as: this.removeMovieClip()
          171,
          (clip) => {
            clip.remove();
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
    // AS frame_1/DoAction.as: SOMA.playSound("arty_102");
    callbacks.playSound("arty_102");

    // Attach the anim1 composite as the root visual content.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
