/**
 * Spell 703 — Grinacement (Sadida).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/703/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no
 * caster-side anchored content, and no dual-anchored WorldAbsolute pattern.
 * The single animation plays at the target cell. The main timeline only plays
 * a sound (grina_703). All visual content is carried by the `anim1` animation
 * in the manifest (135 frames, isComposite=true), which corresponds to
 * DefineSprite_10 in the SWF — the outermost clip that removes itself at
 * frame 133 and signals completion.
 *
 * librarySymbols: none (the manifest has no librarySymbols[] array). The
 * `animations: [{name:"anim1"}]` entry IS the spell content. We register
 * a single symbol named "anim1" from textures.getFrames("anim1") (no lib_
 * prefix — this is an animations[] entry, not a librarySymbols[] entry).
 *
 * Canonical AS layout:
 *
 *   scripts/frame_1/DoAction.as
 *     → SOMA.playSound("grina_703")
 *
 *   DefineSprite_10 (= anim1, 135 frames, the outer timeline):
 *     frame_1/PlaceObject2_9_21/onClipEvent(load):
 *       _parent._alpha = 0;                 ← the inner child sets parent alpha
 *     frame_1/PlaceObject2_9_21/onClipEvent(enterFrame):
 *       _parent._alpha += 2.5;              ← fade in (frames 1-105)
 *     frame_106/PlaceObject2_9_21/onClipEvent(enterFrame):
 *       _parent._alpha -= 3.33;             ← fade out (frames 106+)
 *     frame_133/DoAction.as:
 *       _parent.removeMovieClip();          ← end of spell
 *
 *   DefineSprite_8 (an inner looping sub-sprite):
 *     frame_1/DoAction.as:
 *       gotoAndPlay(random(100) + 2);       ← randomise start offset [2..101]
 *     frame_127/DoAction.as:
 *       gotoAndPlay(2);                     ← loop back to frame 2
 *
 *   DefineSprite_6 (another inner sub-sprite, 4+ frames):
 *     frame_1/DoAction.as:
 *       gotoAndStop(random(4) + 2);         ← freeze at random frame [2..5]
 *
 *   DefineSprite_7/PlaceObject2_6_1/onClipEvent(load):
 *     t = 20 + random(30);
 *     _xscale = t;
 *     _yscale = t;                           ← random scale for a child inside DefineSprite_7
 *
 * Architecture notes:
 *   - The `anim1` 135-frame composite IS the outer DefineSprite_10.
 *   - The inner sub-sprites (DefineSprite_6, DefineSprite_7, DefineSprite_8)
 *     are all BAKED into the `anim1` composite frames — they are not
 *     separately spawned via attachMovie. The composite extractor has already
 *     merged them into the per-frame SVGs.
 *   - The only runtime behaviour we need to reproduce is the ALPHA fade
 *     (carried by the PlaceObject2_9_21 clip events on DefineSprite_10) and
 *     the terminal frame_133 removal.
 *   - signalHit: there is no explicit "this.end()" / hit signal in the AS.
 *     By convention for simple impact spells the hit is signalled at the
 *     first frame of the impact visual (frame_1 / index 0), which fires
 *     immediately on attach.
 *
 * Library symbols:
 *   - "anim1" — 135-frame composite impact. onLoad sets alpha to 0.
 *     onEnterFrame fades in (+2.5/100 per tick) until frame 105, then
 *     fades out (-3.33/100). frame_133 (index 132) removes parent and
 *     signals completion.
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
  width: 231.6,
  height: 164.8,
  offsetX: -108.3,
  offsetY: -124.65,
};

export class Spell703 extends RuntimeSpell {
  readonly spellId = 703;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 135-frame outer impact composite ----------------
    // Mirrors DefineSprite_10 (the outer spelled clip).
    //
    // The PlaceObject2_9_21 child inside DefineSprite_10 controls the
    // alpha of its PARENT (_parent._alpha), so we model that as onLoad
    // and onEnterFrame on the anim1 clip itself.
    //
    // The sub-sprites DefineSprite_6, DefineSprite_7, DefineSprite_8
    // are all baked into the composite SVG frames; no separate attach
    // is needed for them.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 135,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      // AS: DefineSprite_10/frame_1/PlaceObject2_9_21/onClipEvent(load).as
      //   _parent._alpha = 0;
      // The child sets its _parent (= anim1 clip) alpha to 0 on load.
      onLoad: (clip) => {
        clip.alpha = 0;
      },

      // Combined enterFrame for both fade-in and fade-out phases.
      // AS: DefineSprite_10/frame_1/PlaceObject2_9_21/onClipEvent(enterFrame).as
      //   _parent._alpha += 2.5;
      // AS: DefineSprite_10/frame_106/PlaceObject2_9_21/onClipEvent(enterFrame).as
      //   _parent._alpha -= 3.33;
      // In canonical Flash, a second PlaceObject2 on frame_106 REPLACES
      // the enterFrame handler. We model this by branching on currentFrame.
      // Frames 0-104 (AS frames 1-105): fade in. Frames 105+ (AS 106+): fade out.
      onEnterFrame: (clip) => {
        if (clip.currentFrame < 105) {
          // fade-in phase: +2.5 per frame (AS 0-100 → TS 0-1: /100)
          clip.alpha = Math.min(1, clip.alpha + 2.5 / 100);
        } else {
          // fade-out phase: -3.33 per frame
          clip.alpha = Math.max(0, clip.alpha - 3.33 / 100);
        }
      },

      frameScripts: new Map([
        [
          0,
          // Frame 1 entry: signal hit immediately (impact begins).
          // No explicit hit signal in AS; fire at impact start per convention.
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          132,
          // AS: DefineSprite_10/frame_133/DoAction.as
          //   _parent.removeMovieClip();
          // The outer mc is the anim1 clip attached to root; removing
          // root is equivalent to completing the spell.
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
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("grina_703");
    callbacks.playSound("grina_703");

    // Attach the anim1 composite at root so it starts ticking from the
    // next runtime frame. For TargetCell the container is already
    // positioned at the target cell by the harness.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
