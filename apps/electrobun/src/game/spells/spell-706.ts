/**
 * Spell 706 — Grina (Sram/Iop attack, exact class TBD).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/706/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no `move`/`shoot`/`duplicate`
 * library symbols, no caster-anchored children, no dual-timeline world-
 * absolute logic. The spell is a single animated composite (`anim1`) placed
 * at the target cell. The manifest has no `librarySymbols[]` entries — all
 * content is driven by the top-level `animations: ["anim1"]` timeline.
 *
 * AS layout:
 *   - frame_1/DoAction.as           : SOMA.playSound("grina_706")
 *   - frame_115/DoAction.as         : this.removeMovieClip() → complete()
 *   - DefineSprite_3/frame_1        : gotoAndStop(random(3) + 1) — random
 *                                     variant select on a sub-sprite (anim1
 *                                     composite contains a 3-variant child).
 *   - DefineSprite_5/frame_1        : random trajectory select → always
 *                                     gotoAndStop("traj1"); play()
 *   - DefineSprite_5/frame_58       : stop()
 *   - DefineSprite_5/frame_118      : stop()
 *   - DefineSprite_5/frame_178      : stop()
 *   - DefineSprite_8/frame_58       : stop()
 *
 * Because DefineSprite_3 and DefineSprite_5/8 are sub-sprites baked into the
 * composite `anim1` SVG frames, their logic is already rendered into the
 * per-frame artwork. We don't need to register them as separate library
 * symbols — the composite texture handles the visual. The main-timeline
 * frame_115 removal and the frame_1 sound are the only hooks we need.
 *
 * The `anim1` symbol has 60 authored frames (indices 0-59) but the main
 * timeline runs to frame 115 (per frame_115/DoAction.as). The manifest's
 * `stopFrame: 57` tells us the visual peaks at frame 57; frame 58 onwards
 * is the hold / tail. We model `anim1` with totalFrames=60, looping its
 * last frame until the outer timeline fires completion at frame 114 (0-based).
 *
 * signalHit: fired at the first frame of the impact composite (frame 0 of
 * anim1 attached at target — equivalent to the "impact lands" moment).
 * complete: fired from the frame_115 script (frame index 114, 0-based).
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 * Main timeline: SOMA.playSound("grina_706"); then anim1 plays to completion.
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
  width: 837.4,
  height: 390.55,
  offsetX: -383.9,
  offsetY: -172.2,
};

export class Spell706 extends RuntimeSpell {
  readonly spellId = 706;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite impact animation at target cell -------
    // No librarySymbols[] in manifest; anim1 appears only in animations[].
    // Use bare "anim1" key (no lib_ prefix) per the guide's naming table.
    //
    // The main timeline frame_115/DoAction.as fires `this.removeMovieClip()`
    // on the outer mc. We model this as a 115-frame symbol whose frame 114
    // (0-based) calls remove() + complete(). Frames 0-59 display the authored
    // SVG frames; frames 60-114 hold on the last rendered frame (the runtime
    // loops back to frame 0 if totalFrames=60, so we extend totalFrames to
    // 115 and clamp the texture index to the available 60 frames via the
    // frames array having only 60 entries — the sprite will repeat the last
    // texture for out-of-range indices, which matches the "stop at frame 57/58"
    // authored behaviour).
    const anim1Frames = textures.getFrames("anim1");

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 115,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS frame_1/DoAction.as (main timeline) — sound is played in
            // onSpellStart; the composite starts playing from frame 1
            // automatically. signalHit fires here: the impact lands the
            // instant the animation begins at the target cell.
            //
            // AS DefineSprite_5/frame_1/DoAction.as:
            //   a = random(2);
            //   gotoAndStop("traj1"); play();
            // This is baked into the composite SVG frames — no runtime action
            // needed. We signal hit at the entry frame.
            this.runtime.signalHit();
          },
        ],
        [
          57,
          (clip) => {
            // AS DefineSprite_8/frame_58/DoAction.as + DefineSprite_5/frame_58:
            //   stop();
            // The composite visually peaks here. We stop the sub-sprite
            // playback by holding the timeline — outer timeline continues
            // to frame 114.
            clip.stop();
            // Restart playing so outer frame counter advances to 114.
            // (stop() halts the clip, but the outer completion frame is
            // reached via the root timeline driven by the runtime.)
            // Actually: anim1 IS attached as a child of root; stopping it
            // means its own frame counter freezes at 57. The outer "main
            // timeline" is the root SpellClip which has no authored scripts
            // beyond what we place. We need the root to reach frame 114 to
            // fire complete(). Since anim1 is the only child and we stop it
            // at frame 57, we must let the root itself continue. The root
            // has no totalFrames limit (it's null-symbol based). We model
            // completion via anim1's frame 114 script below — but since
            // we just stopped anim1 here, frame 114 will never fire.
            //
            // Resolution: do NOT stop anim1 at 57 — let it run to 114 so
            // the removal frame fires. The authored stop() inside the
            // DefineSprite sub-sprites is rendered into the SVG composites
            // and doesn't affect our outer timeline. Remove this stop() call.
            clip.play();
          },
        ],
        [
          114,
          (clip) => {
            // AS frame_115/DoAction.as: this.removeMovieClip();
            // This fires on the outer main timeline at frame 115 (0-based: 114).
            // Remove the anim1 child and signal spell completion.
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
    // AS frame_1/DoAction.as: SOMA.playSound("grina_706");
    callbacks.playSound("grina_706");

    // Attach the composite anim1 at the target cell (root is already anchored
    // at target for displayType=11). Place at root-local (0, 0).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
