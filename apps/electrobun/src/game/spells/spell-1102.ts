/**
 * Spell 1102 — Aute (unknown class, earth/nature impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1102/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster-side
 * content, no dual-anchor. It is a single impact animation at the target cell.
 * The manifest has one `animations[]` entry ("anim1", 106 frames) and NO
 * `librarySymbols[]` entries — all content is the bare authored timeline.
 *
 * AS layout:
 *   - frame_1/DoAction.as:        SOMA.playSound("aute_1102")
 *   - frame_137/DoAction.as:      this.end()  → signalHit
 *   - frame_159/DoAction.as:      this.removeMovieClip() → spell complete
 *
 *   - DefineSprite_9/frame_1:     gotoAndStop(random(8) + 1) — a sub-sprite
 *                                  that picks one of 8 random frames on load.
 *   - DefineSprite_14/frame_31:   stop()
 *   - DefineSprite_15/frame_105:  stop()
 *
 * The main timeline is 159 frames (frame_159 fires removeMovieClip). The
 * `anim1` animation in the manifest is 106 frames (the visual content up to
 * stopFrame=104). The difference is accounted for by the authored timeline
 * continuing past the visible content (the extractor captured the composite
 * at 106 frames but the SWF main timeline runs to 159).
 *
 * We model this as a single "anim1" symbol registered as the root content.
 * Since manifest has no librarySymbols, the content sits directly in
 * `animations[]`. The frame scripts at 136 (signalHit) and 158 (complete)
 * are placed on the anim1 symbol's timeline. frame_1 (index 0) is handled
 * via onSpellStart for the sound; the anim1 symbol itself just plays through.
 *
 * The sub-sprites (DefineSprite_9, _14, _15) are authored children embedded
 * in the composite frames — they are baked into the SVG exports and do not
 * need separate runtime registration. Their AS scripts (random frame pick,
 * stop) affect only the visual timing which is already captured in the
 * exported frames.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * Main timeline: playSound("aute_1102") on frame_1; signalHit on frame_137;
 *               removeMovieClip on frame_159.
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

    // ---- anim1 — main impact timeline (106 frames of visual content) ----
    // The manifest `animations[]` entry "anim1" carries 106 frames (indices
    // 0-105). The canonical SWF main timeline runs to frame 159, but the
    // extractor captured the composite visual up to frame 106. We model the
    // symbol with 106 total frames and place the signalHit script at frame
    // index 136 (AS frame_137) and complete at frame index 105 (the last
    // available frame) since we cannot advance past the available texture
    // count. However, to be faithful to canonical timing we set totalFrames
    // to 159 (the SWF main-timeline length) and use the anim1 textures for
    // the first 106 frames; frames 106-158 will show the last texture
    // (freeze) which is the canonical behaviour when the SWF content has
    // stopped but the timeline keeps advancing.
    //
    // frame_137/DoAction.as  → frameScripts index 136 → signalHit
    // frame_159/DoAction.as  → frameScripts index 158 → complete
    const anim1Frames = textures.getFrames("anim1");

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 159,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          136,
          (_clip) => {
            // AS scripts/frame_137/DoAction.as: this.end() → damage popup
            this.runtime.signalHit();
          },
        ],
        [
          158,
          (clip) => {
            // AS scripts/frame_159/DoAction.as: this.removeMovieClip()
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

    // Attach the main impact animation at the root so it starts playing
    // from the first tick. For TargetCell the container is already at the
    // target cell; anim1 sits at (0,0) within the container.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
