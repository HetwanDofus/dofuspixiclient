/**
 * Spell 2055 — (unknown name, likely a buff/aura spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2055/scripts/scripts/
 *
 * This spell has a single animation (`anim1`, 144 frames) and no
 * `librarySymbols[]` entries in the manifest. All scripts live inside
 * `DefineSprite_18`, which IS the main animation sprite. The structure is:
 *
 *   - DefineSprite_18 — 144-frame composite animation at the target cell.
 *       frame_1:  SOMA.playSound("gonfle")
 *       frame_4:  PlaceObject2_10_22 placed with onClipEvent(enterFrame):
 *                   _rotation += 2.5 degrees/tick
 *       frame_28: same PlaceObject2_10_22 enterFrame (re-assignment or
 *                 continuation — same script, same instance)
 *       frame_43: same
 *       frame_49: same
 *       frame_61: same
 *       frame_112: this.end() → signalHit
 *       frame_142: stop(); _parent.removeMovieClip() → spell complete
 *
 * The `PlaceObject2_10_22` is a sub-sprite placed at multiple frames that
 * continuously rotates by 2.5 degrees per tick. Since there are no
 * librarySymbols[] entries, the sub-clip's visual content is baked into the
 * composite `anim1` frames — however, its rotation is dynamic (driven by
 * the CLIPACTIONRECORD enterFrame) and must be reproduced at runtime.
 *
 * Because `librarySymbols[]` is empty and the manifest has only `anim1`,
 * we treat `anim1` as the single SymbolDefinition driving the whole spell.
 * The rotating sub-sprite (PlaceObject2_10_22) visual bakes into the anim1
 * composite per-frame, BUT its dynamic rotation accumulation via
 * onClipEvent(enterFrame) must still be modelled: we attach a synthetic
 * child clip (no visible texture, only the rotation enterFrame handler) at
 * the canonical placement frames to faithfully reproduce the behavior.
 *
 * displayType=11 (TargetCell): single impact animation at the target cell,
 * no projectile, no caster reference in any AS script.
 *
 * Library symbols:
 *   - anim1 — 144-frame composite animation at target. frame_112 signals hit;
 *             frame_142 removes self and completes spell.
 *   - rotator — synthetic zero-texture clip representing PlaceObject2_10_22.
 *               onEnterFrame: _rotation += 2.5 degrees/tick (→ radians).
 *               Attached at frames 4, 28, 43, 49, 61 (AS 1-based).
 *
 * Main timeline: SOMA.playSound("gonfle") at frame_1 (via DefineSprite_18
 * frame_1 DoAction — this is the main sprite's first frame).
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
  width: 518,
  height: 391.85,
  offsetX: -249.15,
  offsetY: -278.25,
};

export class Spell2055 extends RuntimeSpell {
  readonly spellId = 2055;
  readonly displayType = SpellDisplayType.TargetCell;

  private rotatorSym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- rotator — synthetic sub-clip mirroring PlaceObject2_10_22 ----
    // This sub-sprite has no library texture (its visual content is
    // composited into anim1's SVG frames by the exporter). We register it
    // with empty frames so the runtime manages its transform independently.
    //
    // AS: DefineSprite_18/frame_{4,28,43,49,61}/PlaceObject2_10_22/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 2.5;
    this.rotatorSym = {
      name: "rotator",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS DefineSprite_18/frame_4/PlaceObject2_10_22/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        //    (identical script repeated at frames 28, 43, 49, 61)
        // _rotation = _rotation + 2.5;  (degrees → radians)
        clip.rotation += (2.5 * Math.PI) / 180;
      },
    };

    // ---- anim1 — 144-frame main composite animation ----------------
    // Covers the full spell visual. Contains:
    //   frame_1  (index 0):  sound played (handled in onSpellStart)
    //   frame_4  (index 3):  attach rotator sub-clip (PlaceObject2_10_22)
    //   frame_28 (index 27): re-attach / ensure rotator is live
    //   frame_43 (index 42): same
    //   frame_49 (index 48): same
    //   frame_61 (index 60): same
    //   frame_112 (index 111): this.end() → signalHit
    //   frame_142 (index 141): stop(); _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 144,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip, ctx) => {
            // AS DefineSprite_18/frame_4/PlaceObject2_10_22 — initial placement
            // of the rotating sub-sprite at depth 22.
            if (!clip.children.has("rotator22")) {
              clip.attach(this.rotatorSym, "rotator22", 22, ctx);
            }
          },
        ],
        [
          27,
          (clip, ctx) => {
            // AS DefineSprite_18/frame_28/PlaceObject2_10_22 — re-assertion of
            // the rotating sub-sprite placement (same enterFrame handler).
            if (!clip.children.has("rotator22")) {
              clip.attach(this.rotatorSym, "rotator22", 22, ctx);
            }
          },
        ],
        [
          42,
          (clip, ctx) => {
            // AS DefineSprite_18/frame_43/PlaceObject2_10_22
            if (!clip.children.has("rotator22")) {
              clip.attach(this.rotatorSym, "rotator22", 22, ctx);
            }
          },
        ],
        [
          48,
          (clip, ctx) => {
            // AS DefineSprite_18/frame_49/PlaceObject2_10_22
            if (!clip.children.has("rotator22")) {
              clip.attach(this.rotatorSym, "rotator22", 22, ctx);
            }
          },
        ],
        [
          60,
          (clip, ctx) => {
            // AS DefineSprite_18/frame_61/PlaceObject2_10_22
            if (!clip.children.has("rotator22")) {
              clip.attach(this.rotatorSym, "rotator22", 22, ctx);
            }
          },
        ],
        [
          111,
          () => {
            // AS DefineSprite_18/frame_112/DoAction.as
            // this.end(); — damage popup / hit signal
            this.runtime.signalHit();
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_18/frame_142/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.rotatorSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_18/frame_1/DoAction.as
    // SOMA.playSound("gonfle");
    callbacks.playSound("gonfle");

    // Attach the main animation clip at the root so it starts ticking
    // from the first runtime frame. displayType=11 anchors the container
    // at the target cell, so anim1 renders centered on the target.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
