/**
 * Spell 514 — Maîtrise des Aiguilles (Needle Mastery / Sram).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/514/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference, no
 * `move`/`shoot`/`duplicate` symbols — the animation plays directly at the
 * target cell. The single `animations[]` entry "anim1" (98 frames, composite)
 * is the entire authored content. There are no `librarySymbols[]` entries in
 * the manifest.
 *
 * The main-timeline frame_1 only plays a sound ("many_503"). The entire visual
 * is driven by the `anim1` symbol, which is a composite 98-frame animation.
 *
 * Internal AS structure (DefineSprite_18 == anim1, 98-frame container):
 *   - frame_11 places a sub-clip (PlaceObject2_17_2) whose:
 *       onClipEvent(load):      tells sub-sub-clips (aig, aig1, aig2, cer) to
 *                               gotoAndPlay(11).
 *       onClipEvent(enterFrame): randomises _alpha = 50 + random(50) each frame.
 *   - frame_79 re-places the same sub-clip with a fresh onClipEvent(load) that
 *       tells the same sub-sub-clips to gotoAndPlay(79).
 *   - frame_97 (AS: frame_97/DoAction.as): _parent.removeMovieClip() — removes
 *       the outer mc, ending the spell.
 *
 * DefineSprite_5, _7, _9, _11 are inner rotating sprites (aig, aig1, aig2, cer
 * references) whose single-frame onEnterFrame script is `_rotation += 5` each tick.
 * These are authored children of the anim1 composite and are fully baked into the
 * per-frame SVG textures — they do NOT need to be registered as separate library
 * symbols. The frame SVGs capture all child transforms at each frame already.
 *
 * The clipEvent scripts (onLoad at frame_11/frame_79, onEnterFrame alpha flicker,
 * and the per-frame +5 rotation on inner sprites) are all INTERNAL to the authored
 * composite timeline. Because the composite is baked into per-frame SVGs by the
 * extractor, the only behavioural hooks we need to implement are:
 *   - The per-frame alpha randomisation on the sub-clip (frames 11-end).
 *   - gotoAndPlay(11) / gotoAndPlay(79) re-entry points (replicated by frameScripts).
 *   - frame_97 → complete().
 *
 * Hit is signalled at the start of the impact (frame 11 is where the
 * needles visually arrive), and complete() is fired at frame_97.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * Animations: anim1 (98 frames) — bare textures.getFrames("anim1").
 *
 * Main timeline: SOMA.playSound("many_503") only.
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
  width: 131.45,
  height: 101.25,
  offsetX: -64,
  offsetY: -50.5,
};

export class Spell514 extends RuntimeSpell {
  readonly spellId = 514;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");

    // anim1 — the entire 98-frame composite animation.
    //
    // Internal authored behaviour ported from:
    //   DefineSprite_18/frame_11/PlaceObject2_17_2/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_18/frame_11/PlaceObject2_17_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   DefineSprite_18/frame_79/PlaceObject2_17_2/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_18/frame_97/DoAction.as
    //
    // The rotating inner sprites (DefineSprite_5, _7, _9, _11 → aig/aig1/aig2/cer)
    // are baked into the per-frame SVGs by the extractor, so we only model the
    // observable outer-clip behaviour: alpha flicker from frame 11 onward, and
    // the final removal at frame 97.
    //
    // Alpha randomisation:
    //   onClipEvent(enterFrame) fires every Flash frame for PlaceObject2_17_2 once
    //   it is placed at frame 11. The effect is: _alpha = 50 + random(50), i.e.
    //   alpha oscillates in [50, 100) percent each frame.  We replicate this as an
    //   onEnterFrame on the anim1 clip itself, active from frame 11 onward.
    //
    // gotoAndPlay re-entry points:
    //   frame_11 load → sub-clips gotoAndPlay(11): already implicit in forward play.
    //   frame_79 load → sub-clips gotoAndPlay(79): already implicit in forward play.
    //   Since the baked SVGs capture child state per-frame, these are no-ops for us.
    //
    // signalHit at frame 11 (needles arrive at target — canonical impact frame).
    // complete()  at frame 97 (canonical: _parent.removeMovieClip()).

    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 98,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      // AS DefineSprite_18/frame_11/PlaceObject2_17_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
      // _alpha = 50 + random(50)
      // This fires every frame once the sub-clip is placed at frame 11.
      // We activate it unconditionally on the anim1 clip and gate it to
      // frames >= 10 (0-based) to match the canonical placement frame.
      onEnterFrame: (clip) => {
        if (clip.currentFrame >= 10) {
          // AS: _alpha = 50 + random(50)  →  0-1 scale
          clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
        }
      },

      frameScripts: new Map([
        [
          // AS DefineSprite_18/frame_11/PlaceObject2_17_2/CLIPACTIONRECORD onClipEvent(load).as
          // aig.gotoAndPlay(11); aig1.gotoAndPlay(11); aig2.gotoAndPlay(11); cer.gotoAndPlay(11);
          // Sub-clips are baked into the SVGs; the only observable effect for us is
          // that this is the canonical impact / hit frame.
          10,
          (_clip) => {
            // Signal hit when the needles arrive at the target (frame 11 = index 10).
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_18/frame_79/PlaceObject2_17_2/CLIPACTIONRECORD onClipEvent(load).as
          // aig.gotoAndPlay(79); aig1.gotoAndPlay(79); aig2.gotoAndPlay(79); cer.gotoAndPlay(79);
          // Baked into SVGs — no action needed at runtime beyond the implicit forward play.
          78,
          (_clip) => {
            // No-op: sub-clip re-entry points are captured in the baked SVG frames.
          },
        ],
        [
          // AS DefineSprite_18/frame_97/DoAction.as
          // _parent.removeMovieClip();
          96,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("many_503");
    callbacks.playSound("many_503");

    // Attach the anim1 composite at root so it begins ticking from
    // the next runtime frame. For displayType=11 the harness has
    // already positioned the container at the target cell; anim1
    // sits at local (0,0) which renders centred on the target.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
