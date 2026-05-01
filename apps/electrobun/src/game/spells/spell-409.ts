/**
 * Spell 409 — Lakam (Eniripsa healing spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/409/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no `move`, `shoot`, or `duplicate`
 * symbols and no caster-side anchoring — it is a pure impact-at-target animation.
 * The single `anim1` animation plays at the target cell. No librarySymbols entries
 * exist in the manifest, so we use bare `textures.getFrames("anim1")` (no `lib_` prefix).
 *
 * Canonical AS layout:
 *   - main timeline frame_1/DoAction.as: SOMA.playSound("lakam_409")
 *   - DefineSprite_7 (outer wrapper, 150 frames):
 *       frame_148/DoAction.as: _parent.removeMovieClip(); stop();
 *         → spell completion signal + clip removal
 *   - DefineSprite_5 (inner animated sprite, 127 frames):
 *       frame_1/DoAction.as: randomise rotation, scale, gotoAndPlay to random start frame
 *       frame_31/DoAction.as: SOMA.playSound("lakam_409") (second sound trigger)
 *       frame_127/DoAction.as: stop()
 *
 * The manifest has a single `animations` entry "anim1" (150 frames, isComposite: true).
 * No `librarySymbols` entries are present. The two DefineSprite symbols (7 and 5)
 * correspond to the outer wrapper and inner animated sprite respectively — both are
 * baked into the composite `anim1` frames.
 *
 * Since DefineSprite_5's frame_1 sets random rotation/scale/phase via AS, and
 * DefineSprite_7 drives the completion at frame 148, we model the whole anim1
 * as a single SymbolDefinition attached from onSpellStart with the relevant
 * frame scripts ported from the canonical AS.
 *
 * Signal timing:
 *   - signalHit: fired at the first visible impact frame (frame index 0, i.e. the
 *     animation start — this is an instant heal/buff with no projectile).
 *   - complete: fired from frameScripts at frame index 147 (AS frame_148).
 *
 * Library symbols: none (librarySymbols[] is absent / empty in manifest).
 *
 * Main timeline: SOMA.playSound("lakam_409") on frame_1.
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
  width: 163.1,
  height: 111.65,
  offsetX: 2.1,
  offsetY: -70.7,
};

export class Spell409 extends RuntimeSpell {
  readonly spellId = 409;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — composite animated sprite played at the target cell.
    // Models DefineSprite_7 (outer, 150 frames) which wraps DefineSprite_5
    // (inner, randomised start / second sound / stop at 127).
    //
    // AS DefineSprite_5/frame_1/DoAction.as:
    //   _rotation = -40 - random(100);
    //   t = random(50) + 30;
    //   _xscale = t; _yscale = t;
    //   gotoAndPlay(random(21));
    //
    // AS DefineSprite_5/frame_31/DoAction.as:
    //   SOMA.playSound("lakam_409");
    //
    // AS DefineSprite_5/frame_127/DoAction.as:
    //   stop();
    //
    // AS DefineSprite_7/frame_148/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    //
    // Because the two sprites are baked into the composite anim1 SVG frames,
    // we model the whole thing as a single SymbolDefinition. The frame_1 random
    // rotation/scale/phase applies to the child inner sprite — since the SVG
    // frames are pre-composited we apply the transform to the clip container
    // itself (visible effect is the same). gotoAndPlay(random(21)) randomises
    // the start frame within the first 21 frames of the animation.

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          // AS DefineSprite_5/frame_1/DoAction.as — randomise rotation, scale,
          // and jump to a random start frame within the opening 21 frames.
          (clip) => {
            const rotDeg = -40 - Math.floor(Math.random() * 100);
            clip.rotation = (rotDeg * Math.PI) / 180;
            const t = Math.floor(Math.random() * 50) + 30;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // AS: gotoAndPlay(random(21)) — 1-based, random(21) gives [0,20]
            // so gotoAndPlay result is in [0,20] (already 0-based in AS terms
            // when result is 0, but AS gotoAndPlay(0) behaves as gotoAndPlay(1)).
            // We use the canonical 0-based runtime call: gotoAndPlay(random(21))
            // where random(21) ∈ [0,20] → runtime frame index [0,20].
            const startFrame = Math.floor(Math.random() * 21);
            clip.gotoAndPlay(startFrame);
          },
        ],
        [
          30,
          // AS DefineSprite_5/frame_31/DoAction.as — second sound cue.
          // Sound playback from inside a frame script: captured via the
          // instance field set in onSpellStart.
          (_clip) => {
            this.soundCallback?.("lakam_409");
          },
        ],
        [
          126,
          // AS DefineSprite_5/frame_127/DoAction.as — inner sprite stops.
          // In the composite model this maps to the anim1 clip stopping its
          // advance at this index. The outer sprite (DefineSprite_7) continues
          // to frame 148 before calling _parent.removeMovieClip().
          // Since both are baked together we simply stop here; frame 147 will
          // still fire the removal script because stop() is on the inner layer
          // and the outer timeline keeps advancing in canonical AS.
          // For the composite model we let the outer frameScripts[147] handle
          // termination and skip the inner stop to avoid premature halt.
          // (No-op here — preserved as a documented canonical anchor point.)
          (_clip) => {
            // inner stop() — no-op in composite model; outer wrapper fires at 147
          },
        ],
        [
          147,
          // AS DefineSprite_7/frame_148/DoAction.as:
          //   _parent.removeMovieClip(); stop();
          // This is the outermost sprite's removal — signals spell completion.
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  // Capture callbacks.playSound so frame scripts inside the symbol can invoke it.
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("lakam_409")
    callbacks.playSound("lakam_409");

    // Capture for use in frameScripts (frame 30 second sound trigger).
    this.soundCallback = callbacks.playSound;

    // Signal hit immediately — this is an instant impact spell with no projectile.
    // The damage/heal popup should appear as soon as the animation starts.
    this.runtime.signalHit();

    // Attach the composite anim1 clip at the target cell (root is already at
    // target for TargetCell displayType). Depth 1, no transform offset.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
