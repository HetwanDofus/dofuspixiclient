/**
 * Spell 2112 — Dodge/Esquive (displayType=11 TargetCell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2112/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no caster
 * reference, no `move`/`shoot`/`duplicate` symbols — it's a single impact
 * animation at the target cell. No `librarySymbols[]` entries in the manifest;
 * the sole animation is the top-level `anim1` timeline (96 frames).
 *
 * Canonical AS layout:
 *   - DefineSprite_17 (anim1 inner loop, frames 1-40):
 *       frame_1:  gotoAndPlay(random(15) + 1) — random start offset [1,15]
 *       frame_40: stop()
 *
 *   - DefineSprite_19 (outer/root sprite, 96 frames):
 *       frame_7:  SOMA.playSound("dodge_610")
 *       frame_94: _parent.removeMovieClip() — spell complete
 *
 * The manifest's `sounds[]` entry `{ frame: 6, soundId: "dodge_610" }` maps to
 * AS frame_7 (0-based index 6), confirming the playSound is in DefineSprite_19/
 * frame_7. signalHit is fired at the canonical impact point (frame 7, when the
 * sound fires and the effect registers on the target).
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 * The `anim1` animation is registered as a container-only symbol that wraps
 * the authored 96-frame timeline, with inner sprite_17 behaviour reproduced
 * via frameScripts on the anim1 symbol itself.
 *
 * Architecture note: Since there are no `librarySymbols[]` entries, we use
 * `textures.getFrames("anim1")` (no `lib_` prefix) for the main animation.
 * The anim1 symbol is attached from `onSpellStart` at depth 1 on the root.
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

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 96-frame outer impact timeline ------------------
    // Combines the behaviour of DefineSprite_19 (the outer container,
    // 96 frames) with the inner DefineSprite_17 loop (40-frame random
    // start). Since the runtime models each attached clip as a flat
    // timeline, we reproduce DefineSprite_19's frame scripts directly
    // here. The DefineSprite_17 inner randomised playback is a visual
    // detail within the authored anim1 composite frames — the key
    // observable events are the sound at frame_7 and the removal at
    // frame_94.
    //
    // AS DefineSprite_19/frame_7/DoAction.as:  SOMA.playSound("dodge_610")
    // AS DefineSprite_19/frame_94/DoAction.as: _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 96,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_17/frame_1/DoAction.as:
          //   gotoAndPlay(random(15) + 1);
          // This fires on the very first frame of the anim1 clip,
          // jumping to a random start offset within [0,14] (0-based)
          // to give visual variety on each cast.
          0,
          (clip) => {
            const offset = Math.floor(Math.random() * 15);
            clip.gotoAndPlay(offset);
          },
        ],
        [
          // AS DefineSprite_17/frame_40/DoAction.as: stop()
          // The inner loop halts at frame 40 (0-based index 39).
          39,
          (clip) => {
            clip.stop();
          },
        ],
        [
          // AS DefineSprite_19/frame_7/DoAction.as:
          //   SOMA.playSound("dodge_610");
          // signalHit here — this is the canonical impact moment.
          6,
          () => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_19/frame_94/DoAction.as:
          //   _parent.removeMovieClip();
          // frame_94 → 0-based index 93.
          93,
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
    // Main timeline implicitly places the anim1 sprite at depth 1.
    // The sound is fired from the frame_7 script inside anim1 itself,
    // but we also honour the manifest sounds[] entry for frame 6
    // (0-based) which maps to the same event.
    // Attach anim1 so it begins ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
