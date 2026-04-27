/**
 * Spell 1002 — Licrounch (Osamodas / Chafer-type impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1002/scripts/scripts/
 *
 * displayType=11 (TargetCell). This is a single impact animation anchored at the
 * target cell. The manifest has no librarySymbols[], no move/shoot/duplicate
 * pattern, no caster-relative positioning, no dual-timeline world-absolute
 * wiring. A single `anim1` animation in `animations[]` plays at the target cell.
 *
 * The canonical SWF main timeline has one authored DefineSprite_23 child placed
 * on the timeline. That sprite drives the full animation:
 *   - frame_1:   SOMA.playSound("licrounch_1001")
 *   - frame_37:  SOMA.playSound("licrounch_1001b")
 *   - frame_112: this.end() → signalHit; PlaceObject2_22_160 clip gets
 *                onClipEvent(enterFrame) that fades _parent._alpha by -10/tick
 *   - frame_148: _parent.removeMovieClip(); stop() → spell complete
 *
 * DefineSprite_4 (frame_28: stop) and DefineSprite_3 (frame_49: stop) are
 * sub-children of DefineSprite_23's authored visual content and are fully
 * captured in the composite `anim1` texture frames — they require no separate
 * TS symbol registration.
 *
 * The fade-out clip (PlaceObject2_22_160 / onClipEvent enterFrame) makes the
 * outer sprite23 fade starting at frame 112. We apply that as an onEnterFrame
 * on a per-frame-range basis driven by a vars flag set at frame 111.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("licrounch_1002").
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

  private sprite23Sym!: SymbolDefinition;

  // Capture sound callback so frameScripts can call it.
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_23 — the main authored timeline child placed on the
    // top-level SWF main timeline. 150 frames. Composite frames captured
    // in `anim1`. Drives sounds, signalHit, alpha-fade, and completion.
    this.sprite23Sym = {
      name: "sprite_23",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onEnterFrame: (clip) => {
        // AS DefineSprite_23/frame_112/PlaceObject2_22_160/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as:
        //   _parent._alpha -= 10;
        // This clip event fires on a child placed at frame_112.
        // We model it as: once the fading flag is set on the parent
        // (sprite_23 itself), we decrement its alpha each tick by
        // 10/100 = 0.1.
        if (clip.vars.fading === true) {
          clip.alpha = Math.max(0, clip.alpha - 0.1);
        }
      },

      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_23/frame_1/DoAction.as:
            //   SOMA.playSound("licrounch_1001");
            this.soundCallback?.("licrounch_1001");
          },
        ],
        [
          36,
          (_clip) => {
            // AS DefineSprite_23/frame_37/DoAction.as:
            //   SOMA.playSound("licrounch_1001b");
            this.soundCallback?.("licrounch_1001b");
          },
        ],
        [
          111,
          (clip) => {
            // AS DefineSprite_23/frame_112/DoAction.as:
            //   this.end();
            // Signals hit (damage popup at target). Also activates the
            // per-frame alpha-fade introduced by the PlaceObject2_22_160
            // clip event placed at this frame.
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
            // _parent here is the outer mc (our root). Signal completion.
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite23Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as:
    //   SOMA.playSound("licrounch_1002");
    callbacks.playSound("licrounch_1002");

    // Capture the sound callback so frameScripts can trigger sounds.
    this.soundCallback = callbacks.playSound;

    // Attach the main authored sprite (DefineSprite_23) onto the root.
    // In the canonical SWF it is implicitly placed on the main timeline
    // at frame_1 as a child MovieClip positioned at the target cell origin.
    this.root.attach(this.sprite23Sym, "sprite23", 1, context);
  }
}
