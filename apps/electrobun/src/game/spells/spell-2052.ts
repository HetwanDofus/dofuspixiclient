/**
 * Spell 2052 — Unknown spell (no AS scripts provided).
 *
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2052/scripts/scripts/
 *
 * The manifest contains a single `animations` entry ("anim1", 12 frames)
 * with no `librarySymbols` and no ActionScript files. This is the
 * self-contained impact pattern: a single authored timeline plays at
 * the target cell with no projectile, no particle attachments, and no
 * runtime-spawned children.
 *
 * displayType=11 (TargetCell): the animation plays entirely at the
 * target cell. There is no caster-side content, no `move`/`shoot`/
 * `duplicate` usage, and no `_parent.cellFrom` references — the
 * canonical default for a standalone impact clip with no AS scripts.
 *
 * Library symbols: none (librarySymbols[] is absent from manifest).
 *
 * Main timeline: single "anim1" animation, 12 frames. signalHit fires
 * at the first frame (impact is immediate). complete() fires at the
 * final frame (frame 12, index 11).
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

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — single 12-frame impact animation ---------------
    // No canonical AS scripts were provided for this spell. The
    // animation plays straight through: signalHit at entry (frame 0),
    // complete() at the final frame (frame 11, AS frame_12).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 12,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // frame_1: impact lands immediately — signal hit.
            this.runtime.signalHit();
          },
        ],
        [
          11,
          (clip) => {
            // frame_12: end of animation — remove and complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // No SOMA.playSound call in the canonical AS (no scripts provided).
    // Attach the single anim1 timeline at the root so it begins ticking.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
