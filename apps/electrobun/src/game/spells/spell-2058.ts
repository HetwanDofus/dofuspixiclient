/**
 * Spell 2058 — (Unknown name, likely a grass/spike trap spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2058/scripts/scripts/
 *
 * displayType=11 (TargetCell). No `move`/`shoot`/`duplicate` symbols,
 * no caster-reference, no projectile motion. The spell has a single
 * authored sprite (DefineSprite_8) that plays a 61-frame impact animation
 * at the target cell, firing two sounds mid-timeline and removing itself
 * (+ calling complete) at frame 61.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Animations in manifest (all top-level, no lib_ prefix):
 *   - anim1  (18 frames) — small directional sprite variant 1
 *   - anim5  (18 frames) — small directional sprite variant 5
 *   - anim9  (75 frames) — main impact / bloom animation
 *   - anim19 (18 frames) — small directional sprite variant 19
 *   - anim23 (18 frames) — small directional sprite variant 23
 *
 * DefineSprite_8 is the outer composite clip that orchestrates the
 * animation. Its authored timeline (61 frames) drives:
 *   frame_1:  SOMA.playSound("herbe")
 *   frame_22: SOMA.playSound("pic")
 *   frame_37: SOMA.playSound("pic")
 *   frame_61: _parent.removeMovieClip(); stop() → spell complete
 *
 * DefineSprite_2/frame_16: stop() — one of the sub-sprites loops a
 * short 16-frame cycle then stops (likely one of the anim1/5/19/23
 * directional sub-sprites).
 *
 * Main timeline: implicitly places DefineSprite_8 at the target cell.
 * We attach it from onSpellStart. No explicit sounds on the main
 * timeline itself — sounds are inside DefineSprite_8's timeline.
 *
 * signalHit: fired at frame_22 (first "pic" impact sound = canonical
 * hit moment). complete() fired at frame_61.
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

// DefineSprite_2 sub-sprite bounds — uses anim1/anim5/anim19/anim23
// (all share the same dimensions per manifest)
const ANIM_SMALL_BOUNDS = {
  width: 25.6,
  height: 15.25,
  offsetX: -9.15,
  offsetY: -15.4,
};

// DefineSprite_8 / anim9 — main impact animation bounds
const ANIM9_BOUNDS = {
  width: 76.1,
  height: 96.1,
  offsetX: -38.75,
  offsetY: -61.05,
};

export class Spell2058 extends RuntimeSpell {
  readonly spellId = 2058;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite8Sym!: SymbolDefinition;
  private sprite2Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const anim9Anchor = calculateAnchor(ANIM9_BOUNDS);
    const animSmallAnchor = calculateAnchor(ANIM_SMALL_BOUNDS);

    // ---- DefineSprite_2 — short looping sub-sprite (16 frames) --
    // AS DefineSprite_2/frame_16/DoAction.as: stop()
    // This is one of the small directional sub-sprites (anim1, anim5,
    // anim19, or anim23 — all same dimensions). We use anim1 as the
    // representative texture set; the harness/main composite provides
    // visual layering. Stops at frame 16 (0-based: 15).
    this.sprite2Sym = {
      name: "sprite2",
      totalFrames: 18,
      frames: textures.getFrames("anim1"),
      anchorX: animSmallAnchor.x,
      anchorY: animSmallAnchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_2/frame_16/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — main 61-frame orchestrating sprite -----
    // Uses anim9 (75 frames, 76×96) as its primary visual content.
    // frame_1:  SOMA.playSound("herbe")
    // frame_22: SOMA.playSound("pic") + signalHit
    // frame_37: SOMA.playSound("pic")
    // frame_61: _parent.removeMovieClip(); stop() → complete
    //
    // The canonical clip is 61 frames long (frame_61 is the last
    // script). anim9 has 75 frames but the canonical stop at frame 61
    // means we only use 61 of them.
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 61,
      frames: textures.getFrames("anim9").slice(0, 61),
      anchorX: anim9Anchor.x,
      anchorY: anim9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as: SOMA.playSound("herbe")
            // Sound is played via onSpellStart at attach time (frame 0 fires
            // immediately on attach). We capture the callback reference
            // in onSpellStart and call it here.
            this.soundCallback?.("herbe");
          },
        ],
        [
          21,
          (_clip) => {
            // AS DefineSprite_8/frame_22/DoAction.as: SOMA.playSound("pic")
            // This is the canonical hit moment (first impact sound).
            this.soundCallback?.("pic");
            this.runtime.signalHit();
          },
        ],
        [
          36,
          (_clip) => {
            // AS DefineSprite_8/frame_37/DoAction.as: SOMA.playSound("pic")
            this.soundCallback?.("pic");
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_8/frame_61/DoAction.as:
            //   _parent.removeMovieClip(); stop()
            // _parent here is the outer mc (root). Signal completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite2Sym);
    this.registry.register(this.sprite8Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture sound callback so frameScripts can play sounds.
    this.soundCallback = callbacks.playSound;

    // Main timeline implicitly places DefineSprite_8 at the target.
    // For displayType=11 (TargetCell), root is already at (0,0) in
    // container-local coords (which equals target in world coords).
    // Attach sprite8 at depth 1; its frame_1 script fires immediately
    // and plays the "herbe" sound via the captured callback.
    this.root.attach(this.sprite8Sym, "sprite8", 1, context);
  }
}
