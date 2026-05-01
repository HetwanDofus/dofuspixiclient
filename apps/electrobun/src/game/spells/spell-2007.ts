/**
 * Spell 2007 — (Unknown spell, likely a simple impact/effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2007/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single animation (`anim1`,
 * 72 frames) with no library symbols and no projectile logic. The only AS
 * script is `DefineSprite_19/frame_70/DoAction.as` which calls
 * `_parent.removeMovieClip()` — i.e. the animation removes its parent (the
 * outer mc) at frame 70, signalling spell completion.
 *
 * Since there are no library symbols and no `librarySymbols[]` in the
 * manifest, `registerSymbols` registers a single `anim1` symbol whose
 * 72-frame timeline plays at the target cell. The `DefineSprite_19` is the
 * container that holds `anim1`; its frame 70 (0-based: 69) fires
 * `_parent.removeMovieClip()`. We model this as a frameScript on the
 * `anim1` symbol at index 69 that calls `clip.parent?.remove()` and
 * `this.runtime.complete()`.
 *
 * signalHit is called at the start of the animation (frame 0) since this
 * is a pure impact effect with no projectile phase.
 *
 * Library symbols: none (no librarySymbols[] in manifest).
 * Main timeline: attach `anim1` at root on spell start.
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
  width: 119.15,
  height: 46.65,
  offsetX: -13.65,
  offsetY: -24.7,
};

export class Spell2007 extends RuntimeSpell {
  readonly spellId = 2007;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 72-frame impact animation at target cell --------
    // Single animation from manifest.animations[0].
    // AS DefineSprite_19/frame_70/DoAction.as: _parent.removeMovieClip()
    // → fires at 0-based frame index 69.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 72,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // Signal hit on first frame — this is a pure impact effect
            // with no projectile phase; damage popups appear immediately.
            this.runtime.signalHit();
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_19/frame_70/DoAction.as:
            //   _parent.removeMovieClip();
            // Removes the outer mc and signals spell completion.
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
    // Main timeline: attach anim1 at root so it starts playing immediately.
    // No SOMA.playSound call present in the canonical AS scripts.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
