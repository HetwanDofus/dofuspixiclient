/**
 * Spell 1002 — Lichcrunch (Liche attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1002/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell is a single impact animation
 * anchored at the target cell. There are no projectile, beam, or
 * world-absolute patterns in the AS — the entire effect plays at the
 * target cell. The manifest has no librarySymbols[] entries (only a
 * single `animations: ["anim1"]` entry), confirming it is a simple
 * self-contained timeline.
 *
 * AS layout:
 *   - frame_1/DoAction.as: SOMA.playSound("licrounch_1002")
 *   - DefineSprite_4/frame_28/DoAction.as: stop()
 *   - DefineSprite_3/frame_49/DoAction.as: stop()
 *   - DefineSprite_23/frame_1/DoAction.as: SOMA.playSound("licrounch_1001")
 *   - DefineSprite_23/frame_37/DoAction.as: SOMA.playSound("licrounch_1001b")
 *   - DefineSprite_23/frame_112/DoAction.as: this.end() → signalHit
 *   - DefineSprite_23/frame_112/PlaceObject2_22_160/CLIPACTIONRECORD
 *       onClipEvent(enterFrame).as: _parent._alpha -= 10  (fade-out on a
 *       child placed at frame 112 of DefineSprite_23)
 *   - DefineSprite_23/frame_148/DoAction.as: _parent.removeMovieClip();
 *       stop() → spell complete
 *
 * The single `anim1` animation is the pre-rendered composite of the
 * authored timeline. DefineSprite_23 is the top-level sprite that drives
 * the whole sequence. Its frame 112 places a fading child (PlaceObject2_22)
 * and fires signalHit; its frame 148 removes the outer mc and ends the
 * spell.
 *
 * Because the manifest has no librarySymbols[], we must NOT use a "lib_"
 * prefix anywhere — `textures.getFrames("anim1")` is the correct key.
 *
 * Library symbols:
 *   - anim1 — 150-frame composite animation at target cell. frame_1 plays
 *     sound; frame_112 signals hit and starts per-frame alpha decay on a
 *     placed child; frame_148 removes parent and completes spell.
 *
 * Main timeline: SOMA.playSound("licrounch_1002"); (frame_1/DoAction.as)
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
  width: 156.55,
  height: 108.15,
  offsetX: -62.75,
  offsetY: -63.45,
};

export class Spell1002 extends RuntimeSpell {
  readonly spellId = 1002;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 150-frame impact composite at target cell -------
    // This symbol is the top-level DefineSprite_23 timeline (the
    // outermost authored sprite). All sub-sprite scripts (DefineSprite_4,
    // DefineSprite_3) are baked into the composite frames. The runtime
    // only needs to drive the frame scripts that produce observable
    // side-effects: sounds, signalHit, fade-out child, and completion.
    //
    // The fade-out child at frame_112 is driven by:
    //   DefineSprite_23/frame_112/PlaceObject2_22_160/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   → _parent._alpha -= 10
    // PlaceObject2_22_160 places a child at depth 160 inside
    // DefineSprite_23 at frame 112. Its onEnterFrame subtracts 10 from
    // _parent._alpha each tick, which is _parent = the anim1 clip itself.
    // We model this directly: at frame 112 we start decrementing
    // clip.alpha by 10/100 = 0.1 per tick via onEnterFrame.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_23/frame_112/PlaceObject2_22_160/
        //   CLIPACTIONRECORD onClipEvent(enterFrame).as:
        //   _parent._alpha -= 10
        // The fade only begins after frame 112 has fired (flagged by
        // clip.vars.fading). Before that frame, this handler is a no-op.
        if (clip.vars.fading === true) {
          clip.alpha = Math.max(0, clip.alpha - 10 / 100);
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_23/frame_1/DoAction.as:
            //   SOMA.playSound("licrounch_1001");
            if (this.soundCallback) {
              this.soundCallback("licrounch_1001");
            }
            clip.play();
          },
        ],
        [
          36,
          () => {
            // AS DefineSprite_23/frame_37/DoAction.as:
            //   SOMA.playSound("licrounch_1001b");
            if (this.soundCallback) {
              this.soundCallback("licrounch_1001b");
            }
          },
        ],
        [
          111,
          (clip) => {
            // AS DefineSprite_23/frame_112/DoAction.as:
            //   this.end() → signals hit (damage popup at target).
            // AS DefineSprite_23/frame_112/PlaceObject2_22_160/
            //   CLIPACTIONRECORD onClipEvent(enterFrame).as:
            //   _parent._alpha -= 10
            // Activate the fade-out flag so onEnterFrame starts
            // decrementing alpha from this tick forward.
            this.runtime.signalHit();
            clip.vars.fading = true;
          },
        ],
        [
          147,
          (clip) => {
            // AS DefineSprite_23/frame_148/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
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
    // AS frame_1/DoAction.as:
    //   SOMA.playSound("licrounch_1002");
    callbacks.playSound("licrounch_1002");

    // Capture sound callback for use inside frame scripts (sounds at
    // frames 1 and 37 of DefineSprite_23 are triggered from frameScripts
    // handlers where callbacks is not directly accessible).
    this.soundCallback = callbacks.playSound;

    // Attach the main animation at root depth 1. It starts ticking from
    // the next runtime frame, mirroring the canonical implicit PlaceObject2
    // of DefineSprite_23 on the main timeline.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
