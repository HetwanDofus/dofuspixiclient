/**
 * Spell 712 — Grina (Sram or similar earth/trap class spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/712/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no
 * dual-anchor, no beam line. It plays a single 135-frame composite
 * animation (anim1) at the target cell. The canonical AS has:
 *
 *   - main timeline frame_1: SOMA.playSound("grina_704")
 *   - DefineSprite_9 (the outer animation sprite):
 *       frame_133: stop(); _parent.removeMovieClip() — ends the spell
 *       frame_82 PlaceObject2_8_26 onClipEvent(enterFrame):
 *           _parent._alpha -= 2.3  — fading effect on clip
 *   - DefineSprite_3 (a sub-sprite):
 *       frame_1: gotoAndStop(random(3) + 1)  — random initial frame
 *   - DefineSprite_5 (a trajectory sub-sprite):
 *       frame_1: random(2) branch → always gotoAndStop("traj1") + play()
 *       frame_58: stop()
 *       frame_118: stop()
 *       frame_178: stop()
 *
 * The manifest has no librarySymbols[] — the entire visual is a single
 * `animations: ["anim1"]` composite with 135 frames. No attachMovie calls
 * reference library symbols. The CLIPACTIONRECORD onClipEvent(enterFrame)
 * at DefineSprite_9/frame_82 drives an alpha fade on the outer clip.
 *
 * Since there are no library symbols and no attachMovie calls, we register
 * a single SymbolDefinition for "anim1" covering the full 135-frame timeline.
 * The onEnterFrame handler ports the alpha-fade CLIPACTIONRECORD.
 * The frame_133 script signals completion.
 *
 * The fade starts from frame_82 (0-indexed: frame 81) when the PlaceObject2
 * places the clip with the enterFrame handler. We model this by starting
 * alpha-fade logic only after frame 81 has been reached.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 * The anim1 animation entry covers everything.
 *
 * Main timeline: SOMA.playSound("grina_704"); (no stop, plays through).
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

export class Spell712 extends RuntimeSpell {
  readonly spellId = 712;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // The main animation symbol. anim1 is in animations[] only (not in
    // librarySymbols[]), so we use the bare "anim1" key — NO lib_ prefix.
    //
    // CLIPACTIONRECORD: DefineSprite_9/frame_82/PlaceObject2_8_26/
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _parent._alpha -= 2.3
    //
    // This handler fades the outer clip (the anim1 clip itself) starting
    // at frame 82 of DefineSprite_9. We model this as: once the clip has
    // advanced past frame 81 (0-indexed), subtract 2.3/100 from alpha
    // each tick. The PlaceObject2 at frame 82 places a sub-clip with this
    // enterFrame, which decrements _parent._alpha — i.e. the anim1 clip's
    // alpha. We wire this directly on the anim1 clip's onEnterFrame so
    // we don't need a separate symbol for the internal sub-clip (it has
    // no visible texture of its own, only the clip-event behavior).
    //
    // DefineSprite_9/frame_133/DoAction.as: stop(); _parent.removeMovieClip()
    // → frameScripts[132]: stop, signal completion.

    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 135,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      // AS: DefineSprite_9/frame_82/PlaceObject2_8_26/CLIPACTIONRECORD onClipEvent(enterFrame).as
      // The placement at frame_82 (0-indexed: 81) attaches a sub-clip whose
      // enterFrame decrements _parent._alpha by 2.3 each tick. We model
      // this directly on the anim1 clip: once the clip reaches frame 81+,
      // apply the fade each tick.
      onEnterFrame: (clip) => {
        // Only start fading after frame 82 (0-indexed: 81) has been reached,
        // mirroring the canonical PlaceObject2 placement at that frame.
        if (clip.currentFrame >= 81) {
          // AS: _parent._alpha -= 2.3  (AS alpha 0-100 → TS 0-1, delta 2.3/100)
          clip.alpha = Math.max(0, clip.alpha - 2.3 / 100);
        }
      },

      frameScripts: new Map([
        [
          132,
          (clip) => {
            // AS: DefineSprite_9/frame_133/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.remove();
            this.runtime.signalHit();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("grina_704");
    callbacks.playSound("grina_704");

    // Attach the anim1 symbol onto the root so it starts playing.
    // The manifest has a single top-level animation entry "anim1" —
    // for displayType=11 (TargetCell), the root is anchored at the
    // target cell and we attach anim1 at root.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
