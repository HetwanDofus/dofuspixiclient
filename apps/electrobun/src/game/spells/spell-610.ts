/**
 * Spell 610 — Esquive (Dodge / Sidestep).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/610/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no `move`, `shoot`, `duplicate`, or
 * WorldAbsolute multi-anchor patterns. It is a single-clip impact animation rendered
 * at the target cell. No library symbols are `attachMovie`'d at runtime — the entire
 * visual is driven by the `anim1` timeline (96 frames, composite SVG sequence).
 *
 * There are two sprites in the canonical AS:
 *
 *   - DefineSprite_9 — the inner timeline (anim1, 96 frames):
 *       frame_1:  gotoAndPlay(random(30) + 1)  — random start phase so
 *                 stacked dodge animations don't sync-flash identically.
 *       frame_40: stop()  — halt at frame 40 (loop-point guard).
 *
 *   - DefineSprite_20 — the outer/root timeline wrapper:
 *       frame_7:  SOMA.playSound("dodge_610")
 *       frame_94: _parent.removeMovieClip()  — signal spell complete.
 *
 * The manifest has NO librarySymbols[] — only a single `animations` entry
 * (`anim1`, 96 frames). The `anim1` symbol serves as the primary display clip,
 * registered with its authored bounds and textures under the bare key `"anim1"`.
 *
 * Signals:
 *   - signalHit: fired at frame_7 (frame index 6, canonical sound/impact frame).
 *   - complete:  fired at frame_94 (frame index 93, _parent.removeMovieClip()).
 *
 * Main timeline (DefineSprite_20) is modelled as the `anim1` symbol's frameScripts
 * because DefineSprite_20 IS the root sprite that wraps anim1 in the SWF. The inner
 * DefineSprite_9 random-start behaviour is baked into anim1's onLoad + frameScripts.
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
  height: 360.9,
  offsetX: -35.55,
  offsetY: -340.7,
};

export class Spell610 extends RuntimeSpell {
  readonly spellId = 610;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 96-frame dodge composite -------------------------
    // Canonical outer wrapper: DefineSprite_20
    //   frame_7/DoAction.as:  SOMA.playSound("dodge_610")
    //   frame_94/DoAction.as: _parent.removeMovieClip()
    //
    // Inner sprite: DefineSprite_9
    //   frame_1/DoAction.as:  gotoAndPlay(random(30) + 1)
    //   frame_40/DoAction.as: stop()
    //
    // The inner DefineSprite_9 random-start logic is modelled via onLoad
    // (fires once when the clip is first attached, equivalent to frame_1
    // actions running before the first tick). The stop() at frame_40
    // matches the authored loop-guard. The outer wrapper's frame_7 sound
    // and frame_94 removal are frameScripts on this same clip, since
    // anim1 IS the visual content of DefineSprite_20.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 96,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_9/frame_1/DoAction.as:
        //   gotoAndPlay(random(30) + 1);
        // Jumps to a random frame in [1,30] (1-based AS) → [0,29] (0-based TS).
        const startFrame = Math.floor(Math.random() * 30);
        clip.gotoAndPlay(startFrame);
      },

      frameScripts: new Map([
        [
          6,
          (_clip) => {
            // AS DefineSprite_20/frame_7/DoAction.as:
            //   SOMA.playSound("dodge_610");
            // Impact frame — signal hit and play sound.
            this.runtime.signalHit();
            this.soundCallback?.("dodge_610");
          },
        ],
        [
          39,
          (clip) => {
            // AS DefineSprite_9/frame_40/DoAction.as:
            //   stop();
            clip.stop();
          },
        ],
        [
          93,
          (clip) => {
            // AS DefineSprite_20/frame_94/DoAction.as:
            //   _parent.removeMovieClip();
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
    // Capture the sound callback so frame scripts can play sounds.
    this.soundCallback = callbacks.playSound;

    // Attach anim1 as the primary visual child on the root clip.
    // This mirrors the implicit placement of DefineSprite_9 (anim1's inner
    // sprite) inside DefineSprite_20 on the main timeline.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
