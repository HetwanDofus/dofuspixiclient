/**
 * Spell 704 — Grina (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/704/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single composite animation anchored at the
 * target cell. No projectile motion, no library symbols via attachMovie —
 * the entire visual is the pre-rendered `anim1` composite timeline.
 *
 * The manifest has no `librarySymbols[]` entries. All animations are in
 * `animations[]` under the bare name `anim1`. Textures are accessed via
 * `textures.getFrames("anim1")` (NO `lib_` prefix).
 *
 * AS script structure:
 *   - frame_1/DoAction.as: SOMA.playSound("grina_704")
 *   - DefineSprite_9/frame_133/DoAction.as: stop(); _parent.removeMovieClip()
 *   - DefineSprite_9/frame_82/PlaceObject2_8_26/onClipEvent(enterFrame):
 *       _parent._alpha -= 2.3
 *       This runs every tick from frame 82 onward, fading the anim1
 *       container. It is a live runtime mutation — not captured in SVGs.
 *   - DefineSprite_3/frame_1/DoAction.as: gotoAndStop(random(3) + 1)
 *   - DefineSprite_5/frame_1/DoAction.as: pick traj1 randomly and play
 *   - DefineSprite_5/frame_58/DoAction.as: stop()
 *   - DefineSprite_5/frame_118/DoAction.as: stop()
 *   - DefineSprite_5/frame_178/DoAction.as: stop()
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline: plays sound "grina_704", runs the anim1 composite for
 * 135 frames (stopFrame=132), alpha-fades from frame 82 via the
 * CLIPACTIONRECORD onEnterFrame handler, removes on frame 133 and
 * signals complete.
 *
 * signalHit: fired at frame 82 (0-based index 81), which is the frame at
 * which PlaceObject2_8_26 is placed and its enterFrame first activates —
 * the canonical impact moment.
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

    // ---- anim1 — composite 135-frame impact animation at target ----
    // Top-level authored symbol corresponding to DefineSprite_9 in the SWF.
    //
    // The CLIPACTIONRECORD onClipEvent(enterFrame) placed at frame 82
    // (PlaceObject2_8_26) runs _parent._alpha -= 2.3 every tick from
    // that frame onward. This is a live per-tick runtime mutation that
    // produces a gradual alpha fade over the remaining ~50 frames of the
    // animation. It must be ported to the anim1 symbol's onEnterFrame
    // handler — it is NOT captured in the exported SVG frames.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 135,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onLoad: (clip) => {
        // Initialise the fade-active flag. The fade only starts once
        // frame 82 (1-based) = index 81 (0-based) is reached, matching
        // the PlaceObject2_8_26 placement frame in the canonical SWF.
        clip.vars.fadeActive = false;
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_9/frame_82/PlaceObject2_8_26/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _parent._alpha -= 2.3
        //
        // PlaceObject2_8_26 is placed on frame 82 (1-based) = index 81
        // (0-based). From that frame onward, every tick this handler
        // fires on the containing clip, decrementing _alpha by 2.3
        // (Flash 0-100 units). In TS: clip.alpha -= 2.3 / 100.
        if (clip.currentFrame >= 81) {
          clip.vars.fadeActive = true;
        }
        if (clip.vars.fadeActive as boolean) {
          clip.alpha = Math.max(0, clip.alpha - 2.3 / 100);
        }
      },

      frameScripts: new Map([
        [
          // Frame 82 (1-based) = index 81 (0-based).
          // PlaceObject2_8_26 is placed here; this is the canonical
          // impact moment — signal hit so damage popups display.
          81,
          (_clip) => {
            // Signal the hit at the frame the impact registers
            // (first tick the alpha-fade CLIPACTIONRECORD activates).
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_9/frame_133/DoAction.as
          //   stop();
          //   _parent.removeMovieClip();
          // frame_133 (1-based) = index 132 (0-based).
          132,
          (clip) => {
            clip.stop();
            clip.parent?.remove();
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
    // AS: frame_1/DoAction.as — SOMA.playSound("grina_704")
    callbacks.playSound("grina_704");

    // Attach the anim1 composite at root so it starts ticking from the
    // next runtime frame. For TargetCell the root container is already
    // positioned at the target cell by the harness.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
