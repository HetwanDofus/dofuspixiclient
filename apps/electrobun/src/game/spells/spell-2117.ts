/**
 * Spell 2117 — Unknown (simple impact animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2117/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile, no caster reference, no
 * library symbols with attachMovie. The manifest has a single `animations`
 * entry (`anim1`, 18 frames) and no `librarySymbols`. The only AS script
 * is `DefineSprite_2/frame_16/DoAction.as` which does:
 *   _parent.removeMovieClip(); stop();
 * This is the canonical outer-mc removal at frame 16 (0-based: 15),
 * triggering spell completion. signalHit is fired at the same frame since
 * there is no earlier canonical hit frame defined in the scripts.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 *
 * Main timeline: single `anim1` animation placed at target cell; plays
 * through 18 frames, completion signalled at frame 16 (0-based: 15).
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
  width: 284.6,
  height: 149.55,
  offsetX: -143.2,
  offsetY: -74.6,
};

export class Spell2117 extends RuntimeSpell {
  readonly spellId = 2117;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 18-frame impact animation at target cell -------
    // AS: DefineSprite_2/frame_16/DoAction.as
    //   _parent.removeMovieClip(); stop();
    // Frame 16 in AS (1-based) = index 15 (0-based).
    // signalHit is also fired here since no earlier hit frame is defined.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 18,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS: DefineSprite_2/frame_16/DoAction.as
            // _parent.removeMovieClip(); stop();
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
    context: SpellContext,
  ): void {
    // Main timeline: place anim1 at the target cell (root origin for
    // displayType=11). No SOMA.playSound in the canonical scripts.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
