/**
 * Spell 1104 — (Unknown name, likely a Feca/shield-type or ambient aura).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1104/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no library symbols, no `move`/`shoot`/
 * `duplicate` references, no `_parent.cellFrom`/`_parent.cellTo` world-absolute
 * positioning. The spell is a single `anim1` animation placed at the target cell.
 * The main timeline runs 159 frames; frame_159 removes the outer mc (spell complete).
 * frame_137 fires `this.end()` — the canonical hit signal.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 *
 * The manifest exposes one animation: `anim1` (98 frames, composite).
 * The main timeline has two internal sprites (DefineSprite_4 and DefineSprite_5)
 * that are the authored sub-timelines within `anim1`. Their frame scripts implement
 * random-start loops so the animation cycles with variation.
 *
 * Main timeline layout:
 *   frame_1:   SOMA.playSound("autre_1104")
 *   frame_137: this.end()  → signalHit
 *   frame_159: this.removeMovieClip()  → complete
 *
 * DefineSprite_4 (sub-timeline inside anim1):
 *   frame_1:   gotoAndPlay(random(40) + 2)  — random start in [2..41]
 *   frame_95:  gotoAndPlay(44)              — loop back to frame 44
 *
 * DefineSprite_5 (sub-timeline inside anim1):
 *   frame_1:   gotoAndPlay(random(40) + 2)  — random start in [2..41]
 *   frame_85:  gotoAndPlay(56)              — loop back to frame 56
 *
 * These sub-timelines are authored into the anim1 composite frames and are
 * driven by the texture extractor — the TS runtime only needs to register
 * anim1 as the root symbol with the correct total frame count and the
 * hit/complete signals at the canonical main-timeline frames.
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
  width: 99.95,
  height: 59.05,
  offsetX: -49.95,
  offsetY: -20.25,
};

export class Spell1104 extends RuntimeSpell {
  readonly spellId = 1104;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main animated composite at target cell ----------
    // The manifest lists this under animations[] (not librarySymbols[]),
    // so we use textures.getFrames("anim1") without a lib_ prefix.
    //
    // The main SWF timeline is 159 frames long. The anim1 asset only
    // captures 98 composite frames (the extractor's frame range). We
    // model the symbol with totalFrames=159 matching the canonical AS
    // timeline length so our frame scripts fire at the right indices.
    // Frames beyond index 97 will reuse the last available texture
    // (the runtime clamps frame index into the frames array).
    //
    // DefineSprite_4 frame_1: gotoAndPlay(random(40) + 2)
    // DefineSprite_4 frame_95: gotoAndPlay(44)
    // DefineSprite_5 frame_1: gotoAndPlay(random(40) + 2)
    // DefineSprite_5 frame_85: gotoAndPlay(56)
    //
    // These sub-sprite loops are baked into the composite anim1 frames
    // by the extractor; the TS runtime doesn't need to replicate them
    // separately — the frame scripts below cover only the main-timeline
    // signals (hit + complete).

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 159,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // scripts/frame_137/DoAction.as: this.end()
          136,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // scripts/frame_159/DoAction.as: this.removeMovieClip()
          158,
          (clip) => {
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
    // scripts/frame_1/DoAction.as: SOMA.playSound("autre_1104")
    callbacks.playSound("autre_1104");

    // Attach anim1 at root so the main-timeline animation plays.
    // displayType=11 (TargetCell): the container is already positioned
    // at the target cell by the harness; anim1 sits at local (0,0).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
