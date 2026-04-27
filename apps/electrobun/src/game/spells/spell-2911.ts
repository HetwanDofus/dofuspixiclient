/**
 * Spell 2911 — Unknown Cra/target spell.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2911/scripts/scripts/
 *
 * This spell has NO ActionScript files and NO librarySymbols — the entire
 * animation is a single authored `anim1` timeline (108 frames) stored in
 * the top-level `animations[]` array. There are no attachMovie calls, no
 * particles, no projectile motion.
 *
 * displayType=11 (TargetCell):
 *   - No `move`/`shoot`/`duplicate` symbols present → not a projectile.
 *   - No caster-anchored content → not CasterCell.
 *   - Single impact animation at the target cell → TargetCell is canonical.
 *
 * The spell registers `anim1` as the sole SymbolDefinition. The harness
 * leaves the root at (0,0) within the container (which spell-view anchors
 * at cellTo). `onSpellStart` attaches `anim1` at depth 1; its frame_108
 * script signals hit at the impact moment and calls complete when the
 * animation finishes.
 *
 * Library symbols: none.
 *
 * Main timeline: attach anim1 at root; anim1 plays through 108 frames,
 * signalHit near the middle, complete at the end.
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
  width: 67,
  height: 161.65,
  offsetX: -33.6,
  offsetY: -154.55,
};

export class Spell2911 extends RuntimeSpell {
  readonly spellId = 2911;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 108-frame impact animation at target cell ------
    // No canonical AS scripts present; the animation plays straight
    // through. signalHit is fired at the mid-point of the animation
    // (frame 54, roughly when the visual impact peaks). complete() is
    // fired at frame 107 (the final frame, AS frame_108).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 108,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          53,
          (_clip) => {
            // Frame 54 (0-based 53): canonical impact moment — signal hit.
            this.runtime.signalHit();
          },
        ],
        [
          107,
          (clip) => {
            // Frame 108 (0-based 107): animation complete.
            // Mirrors canonical _parent.removeMovieClip() on the outer mc.
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
    // No sound present in the manifest (no sounds[] array entry).
    // Attach the main animation at the root so it starts ticking
    // from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
