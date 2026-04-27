/**
 * Spell 2052 — Unknown (simple looping animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2052/scripts/scripts/
 *
 * displayType=11 (TargetCell). No ActionScript files are present in the
 * exported scripts directory, which means this spell has no authored
 * timeline scripts beyond the default Flash behaviour: the main SWF
 * places a single `anim1` animation directly on the main timeline and
 * plays it through to completion.
 *
 * The manifest contains no `librarySymbols[]` entries (only a single
 * `animations[]` entry named "anim1" with 12 frames). There is no
 * `attachMovie` in any AS file — the content is purely authored on the
 * main timeline. Because there are no library symbols, no `lib_` prefix
 * is used anywhere.
 *
 * The animation plays 12 frames and then the spell is considered
 * complete. signalHit is fired on frame 1 (first impact frame, since
 * there is no explicit hit frame in the AS — we use the conventional
 * first frame for an impact-style target-cell spell). complete() is
 * fired on the final frame (frame 12, index 11).
 *
 * Library symbols: none.
 *
 * Main timeline: single `anim1` composite animation, 12 frames,
 * looping not required (stop at end).
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
  width: 7.05,
  height: 7.6,
  offsetX: -3.5,
  offsetY: -3.8,
};

export class Spell2052 extends RuntimeSpell {
  readonly spellId = 2052;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // anim1 is the sole animation entry in manifest.json animations[].
    // It is NOT a librarySymbol, so we use the bare name "anim1" (no lib_ prefix).
    // Bounds come from animations[0].{width,height,offsetX,offsetY}.
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 12,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      // No canonical onLoad or onEnterFrame scripts exist in the AS source.
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // frame_1 (index 0): first frame of the animation — signal hit.
            // No explicit hit frame in the AS; for a TargetCell impact spell
            // the conventional first rendered frame is the hit moment.
            this.runtime.signalHit();
          },
        ],
        [
          11,
          (clip) => {
            // frame_12 (index 11): final frame of the 12-frame animation.
            // No canonical _parent.removeMovieClip() script exists, but the
            // animation has finished — stop the clip and signal completion.
            clip.stop();
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
    // No SOMA.playSound() call is present in the canonical AS source
    // (no ActionScript files were exported for this spell).
    // Attach anim1 at depth 1 on the root so it starts ticking.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
