/**
 * Spell 704 — Grina (Osamodas earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/704/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no `move`, `shoot`, or
 * `duplicate` symbols and no caster-anchored content. The single
 * `animations[]` entry (`anim1`, 135 frames) is the main visual,
 * played directly at the target cell. There are no `librarySymbols[]`
 * entries in the manifest — all content lives in the flat `anim1`
 * timeline. The outer sprite (DefineSprite_9) drives the main 135-frame
 * animation; it stops at frame 133 and removes the parent (= spell
 * complete). A clip event on one of its children fades alpha by 2.3
 * per frame starting from frame 82.
 *
 * DefineSprite_3 (a sub-composite inside anim1) jumps to a random frame
 * in [1..3] on load and stops — this is baked into the composite SVG
 * frames and does not require runtime wiring.
 *
 * DefineSprite_5 (another sub-composite inside anim1) picks a random
 * trajectory label on frame_1 (all branches resolve to "traj1" so
 * the effective result is always `gotoAndStop("traj1"); play()`), then
 * stops at frames 58, 118, and 178. This is also baked into the
 * composite SVG frame sequence.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest.json).
 * The entire visual is driven by the `anim1` pre-rendered composite.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("grina_704").
 *
 * Signal hit: fired at the canonical impact frame. Reviewing the AS,
 * DefineSprite_9/frame_82 is where the fade-out clip event kicks in,
 * indicating the hit has landed by that point. We fire signalHit at
 * frame 82 (index 81).
 *
 * Signal complete: fired from the frame_133 script (index 132) which
 * calls `stop(); _parent.removeMovieClip();`.
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
  width: 390.9,
  height: 224.75,
  offsetX: -198.15,
  offsetY: -175.9,
};

export class Spell704 extends RuntimeSpell {
  readonly spellId = 704;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main composite timeline (135 frames) -----------
    // This is the sole visual for spell 704. It is listed in
    // animations[] (not librarySymbols[]), so we use the bare name
    // "anim1" (no lib_ prefix) for both the symbol name and the
    // textures.getFrames key.
    //
    // DefineSprite_9/frame_133/DoAction.as:
    //   stop(); _parent.removeMovieClip();
    //
    // DefineSprite_9/frame_82/PlaceObject2_8_26/
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _parent._alpha -= 2.3;
    //   (fade starts at frame 82 — indicates impact has occurred)
    //
    // We model the fade-out via onEnterFrame activated after frame 82,
    // and spell completion at frame 133 (index 132).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 135,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_82/PlaceObject2_8_26/
        //   CLIPACTIONRECORD onClipEvent(enterFrame).as:
        //   _parent._alpha -= 2.3;
        // This clip event is placed at frame 82 on a child of
        // DefineSprite_9 and fires every frame thereafter. We
        // approximate this by starting the fade once the clip has
        // reached frame 81 (0-based) or beyond.
        if (clip.currentFrame >= 81) {
          clip.alpha = Math.max(0, clip.alpha - 2.3 / 100);
        }
      },
      frameScripts: new Map([
        [
          // AS DefineSprite_9/frame_82 — hit has landed; signal it.
          // (frame_82 in AS = index 81 here)
          81,
          () => {
            // Canonical impact indicator: the fade-out clip event
            // starts here, so this is the hit frame.
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_9/frame_133/DoAction.as:
          //   stop(); _parent.removeMovieClip();
          // (frame_133 in AS = index 132 here)
          132,
          (clip) => {
            clip.stop();
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
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("grina_704");
    callbacks.playSound("grina_704");

    // Attach the main anim1 clip at the root so it starts playing.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
