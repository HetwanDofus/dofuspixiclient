/**
 * Spell 1006 — (Unknown, likely a self-buff or target impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1006/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no projectile symbols (move/shoot/duplicate),
 * no caster-anchored references, no dual-anchored timelines. The spell is a single
 * animated timeline placed at the target cell. This matches the most common impact
 * pattern (TargetCell).
 *
 * Manifest layout:
 *   - animations: [ "anim1" (130 frames, composite) ] — NO librarySymbols entries.
 *   - librarySymbols: (empty) — so NO lib_ prefix anywhere.
 *
 * AS symbol layout:
 *   - DefineSprite_5 — inner sprite. On frame_1: gotoAndPlay(random(15) + 1)
 *     (randomises the start frame so repeated casts don't look identical).
 *     On frame_149: stop().
 *   - DefineSprite_37 — outer timeline (130 frames maps to anim1):
 *       frame_97:  this.end() → signalHit (damage popup).
 *       frame_129: _parent.removeMovieClip(); stop() → spell complete.
 *
 * Because librarySymbols is empty in the manifest, anim1 is the sole top-level
 * animation. DefineSprite_37 IS the anim1 symbol (the outer container with 130
 * authored frames). DefineSprite_5 is an inner composited sprite referenced by
 * the anim1 composite frames — its frame scripts randomise the playhead on load
 * and stop at frame 149. Since it is embedded inside anim1 composite frames and
 * not separately attachMovie'd, we model it as part of the anim1 symbol's frame
 * scripts (frame_1 randomises, the stop at frame_149 is moot as the outer timeline
 * only runs 130 frames).
 *
 * Main timeline: attaches anim1 in onSpellStart (no SOMA.playSound found in
 * the scripts provided, so none is emitted).
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
  width: 96.75,
  height: 76.1,
  offsetX: -36.1,
  offsetY: -64.2,
};

export class Spell1006 extends RuntimeSpell {
  readonly spellId = 1006;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main impact timeline (130 frames) ---------------
    // Corresponds to DefineSprite_37 in the canonical SWF.
    // No librarySymbols entry in the manifest — texture key is bare "anim1".
    //
    // AS DefineSprite_37/frame_97/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_37/frame_129/DoAction.as: _parent.removeMovieClip(); stop()
    //
    // DefineSprite_5 is an inner composited sprite embedded in the anim1
    // composite frames. Its canonical frame_1 does:
    //   gotoAndPlay(random(15) + 1)
    // Since it plays through anim1's composite frames and is not separately
    // attachMovie'd, its randomised-start behaviour is baked into the
    // pre-rendered composite frames — no separate SymbolDefinition needed.
    // The frame_1 gotoAndPlay on the outer symbol mirrors the randomised
    // entry point behaviour at the anim1 level.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 130,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5/frame_1/DoAction.as (inner sprite, frame_1):
            //   gotoAndPlay(random(15) + 1)
            // Mirrors the randomised entry-point on the outer timeline so
            // repeated casts begin at a random frame within the first 15.
            const randomStart = Math.floor(Math.random() * 15) + 1;
            clip.gotoAndPlay(randomStart - 1);
          },
        ],
        [
          96,
          () => {
            // AS DefineSprite_37/frame_97/DoAction.as:
            //   this.end();
            // Signals hit (damage popup) at the canonical impact frame.
            this.runtime.signalHit();
          },
        ],
        [
          128,
          (clip) => {
            // AS DefineSprite_37/frame_129/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline implicitly places anim1 (DefineSprite_37) on the
    // stage. Attach it here so it starts ticking from the next runtime
    // frame. No SOMA.playSound found in the provided AS scripts.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
