/**
 * Spell 2112 — (Unknown name, likely a dodge/evasion spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2112/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no caster-anchored logic,
 * no dual-anchored world-absolute layout, and no beam. The spell is a single
 * animated clip at the target cell. Both DefineSprite_17 and DefineSprite_19
 * are purely timeline-driven with no attachMovie calls referencing external
 * library symbols. The manifest has no librarySymbols[] entries and only one
 * animation ("anim1") — the canonical simple impact-at-target pattern.
 *
 * Canonical AS layout:
 *
 *   - Main timeline: 96 frames (anim1), contains:
 *       - DefineSprite_17 (inner loop sprite, random entry, stops at frame 40)
 *       - DefineSprite_19 (outer wrapper, 96 frames):
 *           frame_7:  SOMA.playSound("dodge_610")
 *           frame_94: _parent.removeMovieClip() → spell complete
 *
 * Since librarySymbols[] is empty and there are no attachMovie calls in the AS,
 * the entire animation is driven by the single pre-rendered `anim1` timeline.
 * DefineSprite_17 and DefineSprite_19 are internal composites baked into anim1;
 * their frame scripts (random entry, stop, sound, removal) must be reproduced
 * on the registered symbol.
 *
 * The outer symbol (DefineSprite_19) corresponds to "anim1" in the manifest.
 * DefineSprite_17 is an inner sprite embedded within DefineSprite_19 — but since
 * there are no attachMovie calls and no librarySymbols[] entries, the combat
 * exporter has composited them into the anim1 frame sequence. We register "anim1"
 * as the single SymbolDefinition driving both timeline scripts.
 *
 * signalHit: fired at frame_7 (frame index 6), which is also when the dodge
 * sound plays — canonical impact moment.
 * complete: fired at frame_94 (frame index 93) via _parent.removeMovieClip().
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
  width: 70.5,
  height: 278.8,
  offsetX: -35.55,
  offsetY: -258.6,
};

export class Spell2112 extends RuntimeSpell {
  readonly spellId = 2112;
  readonly displayType = SpellDisplayType.TargetCell;

  private callbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — the single composite animation at target cell ----
    // Encodes the behaviour of both DefineSprite_17 (inner loop) and
    // DefineSprite_19 (outer wrapper) as seen in the canonical AS files.
    //
    // DefineSprite_17/frame_1/DoAction.as:  gotoAndPlay(random(15) + 1)
    // DefineSprite_17/frame_40/DoAction.as: stop()
    //
    // DefineSprite_19/frame_7/DoAction.as:  SOMA.playSound("dodge_610")
    // DefineSprite_19/frame_94/DoAction.as: _parent.removeMovieClip()
    //
    // The inner DefineSprite_17 randomises its entry point to one of the
    // first 15 frames and stops at frame 40. Since it is composited into
    // anim1 by the exporter, we reproduce this via the outer symbol's
    // frameScripts — the random gotoAndPlay at entry (frame index 0) and
    // stop at frame index 39 both operate on the anim1 clip itself,
    // mirroring what the inner sprite would have done.

    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 96,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_17/frame_1/DoAction.as:
          //   gotoAndPlay(random(15) + 1);
          // 0-based: gotoAndPlay(random(15) + 1 - 1) = gotoAndPlay(random(15))
          0,
          (clip) => {
            clip.gotoAndPlay(Math.floor(Math.random() * 15));
          },
        ],
        [
          // AS DefineSprite_17/frame_40/DoAction.as:
          //   stop();
          39,
          (clip) => {
            clip.stop();
          },
        ],
        [
          // AS DefineSprite_19/frame_7/DoAction.as:
          //   SOMA.playSound("dodge_610");
          // Also canonical hit moment — signal hit here.
          6,
          (_clip) => {
            this.callbacks?.playSound("dodge_610");
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_19/frame_94/DoAction.as:
          //   _parent.removeMovieClip();
          93,
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
    // Capture callbacks so frame scripts can use playSound.
    this.callbacks = callbacks;

    // Attach the single anim1 composite at the target cell (root is
    // already anchored at target for displayType=11).
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
