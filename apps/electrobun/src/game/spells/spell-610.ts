/**
 * Spell 610 — Esquive (Dodge).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/610/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no library symbols with
 * `attachMovie` calls, no `move`/`shoot`/`duplicate` pattern, and no
 * caster-anchored elements. It is a single animated composite (`anim1`)
 * played at the target cell. The manifest has no `librarySymbols[]` —
 * the animation content lives entirely in the `animations[]` entry
 * `anim1` (96 frames). Two DefineSprite children drive the timeline:
 *
 *   - DefineSprite_9 — inner animated clip (sub-symbol). frame_1 jumps
 *     to a random frame in [1..30] via `gotoAndPlay(random(30) + 1)`.
 *     frame_40 stops the clip.
 *
 *   - DefineSprite_20 — outer / wrapper clip (96 frames total).
 *     frame_7  plays "dodge_610" sound.
 *     frame_94 calls `_parent.removeMovieClip()` → spell complete.
 *
 * Because the manifest has no `librarySymbols[]`, there are no
 * `attachMovie` calls; the DefineSprite children are placed on the
 * authored timeline. We model this as a single `anim1` symbol driving
 * the top-level visual, with its frameScripts porting the DefineSprite_20
 * actions (sound at frame 7, removal at frame 94). The DefineSprite_9
 * random-seek is an internal sub-clip behaviour that is already baked
 * into the composite anim1 frame sequence.
 *
 * signalHit is fired at frame 7 (the impact / sound frame), which is
 * the canonical first meaningful hit cue for a dodge/impact animation.
 *
 * Main timeline: no explicit SOMA.playSound on the outer timeline;
 * the sound is inside DefineSprite_20/frame_7. No onSpellStart sound.
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

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 96-frame composite at target cell ---------------
    // Ports DefineSprite_20 timeline actions:
    //   frame_7/DoAction.as:  SOMA.playSound("dodge_610")
    //   frame_94/DoAction.as: _parent.removeMovieClip()
    //
    // DefineSprite_9 (inner sub-clip) logic:
    //   frame_1/DoAction.as:  gotoAndPlay(random(30) + 1)
    //   frame_40/DoAction.as: stop()
    // The DefineSprite_9 sub-clip is baked into the composite anim1
    // frame textures; its random-seek only affects which of the first
    // 30 frames it starts from. We model the outer DefineSprite_20
    // as the anim1 symbol driving the full 96-frame timeline.
    // The random seek maps to: gotoAndPlay(Math.floor(Math.random()*30)+1)
    // → clip.gotoAndPlay(Math.floor(Math.random() * 30)) at entry.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 96,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_9/frame_1/DoAction.as:
            //   gotoAndPlay(random(30) + 1);
            // The inner DefineSprite_9 seeks to a random frame in [1..30].
            // We mirror this on the composite clip itself so the animation
            // starts from a random offset in the first 30 frames.
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
          },
        ],
        [
          6,
          (clip) => {
            // AS DefineSprite_20/frame_7/DoAction.as:
            //   SOMA.playSound("dodge_610");
            // Sound is stored in clip.vars so the frameScript can access
            // the callback captured during onSpellStart. If not available,
            // the sound is simply skipped gracefully.
            const playSoundFn = clip.vars.playSound as
              | ((id: string) => void)
              | undefined;
            if (playSoundFn) {
              playSoundFn("dodge_610");
            }
            // Signal hit at the impact / sound frame.
            this.runtime.signalHit();
          },
        ],
        [
          39,
          (clip) => {
            // AS DefineSprite_9/frame_40/DoAction.as:
            //   stop();
            // The inner sub-clip stops at frame 40. Since we're modelling
            // the composite, this is a no-op on the outer timeline but we
            // mirror it for semantic correctness — the outer clip (anim1)
            // continues to play through frame 94.
            // No action needed on the composite level.
            void clip;
          },
        ],
        [
          93,
          (clip) => {
            // AS DefineSprite_20/frame_94/DoAction.as:
            //   _parent.removeMovieClip();
            // Remove the anim clip and signal spell completion.
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
    // No sound on the outer main timeline (sound is in DefineSprite_20/
    // frame_7, fired from the frameScript above via clip.vars.playSound).
    // Attach anim1 at the root so it begins ticking from the next frame.
    // Store the playSound callback on the clip so the frame_7 script
    // can invoke it.
    const clip = this.root.attach(this.anim1Sym, "anim1", 1, context);
    clip.vars.playSound = callbacks.playSound;
  }
}
