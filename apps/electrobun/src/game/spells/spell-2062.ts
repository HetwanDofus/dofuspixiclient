/**
 * Spell 2062 — (Unknown name, single-animation impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2062/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no
 * library symbols with attachMovie, no caster-side reference, and no
 * duplicate/beam pattern. It is a single authored animation (`anim1`,
 * 21 frames) that plays at the target cell. The only AS script is
 * DefineSprite_2/frame_19/DoAction.as which calls
 * `_parent.removeMovieClip(); stop();` — the canonical outer-mc removal
 * at the end of the animation, signalling spell completion.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 *
 * Main timeline: no explicit SOMA.playSound or child attaches found.
 * The single symbol `anim1` is the main animation and is registered as
 * a container-driven SymbolDefinition with a frameScripts entry at
 * frame 18 (AS frame_19) that removes the parent and fires complete().
 *
 * Signal hit: fired at frame 18 (the impact/removal frame), which is
 * also the canonical `stopFrame` from the manifest.
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
  width: 235.05,
  height: 123.5,
  offsetX: -118.3,
  offsetY: -61.65,
};

export class Spell2062 extends RuntimeSpell {
  readonly spellId = 2062;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 21-frame impact animation at target cell -------
    // AS DefineSprite_2/frame_19/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    //
    // The animation plays through 21 frames. At frame 19 (0-based: 18)
    // the canonical AS removes the outer mc and stops. We fire
    // signalHit() at the same frame since that is the canonical impact
    // moment (stopFrame=18 per manifest), then complete the spell.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 21,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          18,
          (clip) => {
            // AS DefineSprite_2/frame_19/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            this.runtime.signalHit();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // No SOMA.playSound in canonical main timeline for this spell.
    // Attach anim1 at the root so it begins playing at target cell.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
