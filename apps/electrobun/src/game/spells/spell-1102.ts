/**
 * Spell 1102 — Autoportrait (unknown class, likely Osamodas or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1102/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no caster
 * reference, no dual-anchored placement, no beam/duplicate logic. It is a single
 * impact animation at the target cell. The manifest has a single `animations[]`
 * entry ("anim1", 106 frames, isComposite=true) and no `librarySymbols[]`.
 *
 * Canonical AS layout:
 *   - frame_1/DoAction.as          : SOMA.playSound("aute_1102")
 *   - frame_137/DoAction.as        : this.end()  → signalHit
 *   - frame_159/DoAction.as        : this.removeMovieClip() → spell complete
 *   - DefineSprite_9/frame_1       : gotoAndStop(random(8) + 1)  — 8-variant
 *                                    random-stop inside an inner sprite
 *   - DefineSprite_14/frame_31     : stop()
 *   - DefineSprite_15/frame_105    : stop()
 *
 * The manifest shows a single composite animation "anim1" with 106 authored
 * frames (stopFrame=104). The main SWF timeline is longer (at least 159 frames
 * at 30 fps authored rate; at TRIPLEFRAMERATE 60 fps the runtime ticks through
 * those frames 3× faster per wall-second). The inner DefineSprite_9/14/15 are
 * sub-composites baked into anim1's SVG frames — their frame scripts are already
 * reflected in the composite rasterisation. However, the main-timeline signals
 * (hit at frame 137, complete at frame 159) must still be wired explicitly.
 *
 * Because `librarySymbols` is empty, there are no attachMovie calls and no
 * CLIPACTIONRECORD-driven live clips. The whole visual is driven by the single
 * "anim1" timeline registered as the root symbol. We register "anim1" as the
 * primary symbol and attach it from onSpellStart so the runtime drives its
 * playhead — this lets the frameScripts at frames 136 and 158 (0-based) fire
 * at the correct wall-time moments.
 *
 * Main timeline scripted frames (AS 1-based → 0-based):
 *   frame_1   (index 0)  : playSound — handled in onSpellStart
 *   frame_137 (index 136): this.end() → signalHit
 *   frame_159 (index 158): this.removeMovieClip() → complete
 *
 * Library symbols: none (librarySymbols[] is absent/empty).
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
  width: 223.45,
  height: 177.05,
  offsetX: -136.35,
  offsetY: -123,
};

export class Spell1102 extends RuntimeSpell {
  readonly spellId = 1102;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // "anim1" is in animations[] only — use bare name (no lib_ prefix).
    // The main SWF timeline is 159 frames at authored 30 fps; at
    // TRIPLEFRAMERATE (60 fps) the runtime ticks twice as fast per
    // wall-second, so the 106-frame composite SVG sequence maps onto
    // the first portion of the playhead. We model the full authored
    // 159-frame timeline here so frame scripts at indices 136 and 158
    // fire at the correct relative moments.
    //
    // DefineSprite_9 (random 8-variant stop), DefineSprite_14 (stop at
    // frame 31), and DefineSprite_15 (stop at frame 105) are sub-sprites
    // baked into the composite SVG frames — their visual output is
    // already present in anim1's rasterised textures. Their internal
    // frame scripts (gotoAndStop, stop) affect only their own sub-
    // timelines inside the composite and do not need separate runtime
    // clips.

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 159,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          136,
          (_clip) => {
            // AS scripts/frame_137/DoAction.as: this.end()
            // → damage popup / hit signal for the combat sequencer.
            this.runtime.signalHit();
          },
        ],
        [
          158,
          (clip) => {
            // AS scripts/frame_159/DoAction.as: this.removeMovieClip()
            // The outer mc is removed → spell is complete.
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
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("aute_1102")
    callbacks.playSound("aute_1102");

    // Attach anim1 at the root so the runtime drives its playhead
    // from the next tick onward. Depth 1, at local origin (0,0) which
    // is already anchored at the target cell by the TargetCell harness.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
