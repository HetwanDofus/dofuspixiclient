/**
 * Spell 1001 — Licrounch (target-cell impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1001/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single animated timeline placed at the
 * target cell. No projectile motion, no caster reference, no attachMovie
 * library symbols in librarySymbols[].
 *
 * AS layout — DefineSprite_23 is the main authored 150-frame sprite:
 *   frame_1:   SOMA.playSound("licrounch_1001")
 *   frame_37:  SOMA.playSound("licrounch_1001b")
 *   frame_109: this.end() → signalHit
 *              PlaceObject2_22_144 is placed here with an
 *              onClipEvent(enterFrame): _parent._alpha -= 3.34
 *              This is a child clip whose per-tick handler fades
 *              DefineSprite_23 (_parent) by 3.34 alpha units per frame.
 *   frame_148: _parent.removeMovieClip(); stop() → spell complete
 *
 *   DefineSprite_4 stops at frame 28 (sub-sprite baked into composite).
 *   DefineSprite_3 stops at frame 49 (sub-sprite baked into composite).
 *
 * The composite anim1 animation (150 frames, 131×108 px) is the pre-rendered
 * output of DefineSprite_23's authored timeline. We register it as "anim1"
 * and attach it at root so frame scripts fire at canonical frames.
 *
 * PlaceObject2_22_144 (the fade driver) is modelled as a separate
 * SymbolDefinition "fadeDriver" with an onEnterFrame that decrements
 * its parent's alpha. It is attached from anim1's frame_109 script,
 * mirroring the canonical PlaceObject2 placement at that frame.
 *
 * Library symbols: none in librarySymbols[] — no lib_ prefix used.
 *
 * Main timeline: SOMA.playSound("licrounch_1001"); (frame_1/DoAction.as)
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
  width: 131.1,
  height: 108.15,
  offsetX: -62.75,
  offsetY: -63.45,
};

export class Spell1001 extends RuntimeSpell {
  readonly spellId = 1001;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private fadeDriverSym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- fadeDriver — PlaceObject2_22_144 placed at frame_109 ----
    // AS: DefineSprite_23/frame_109/PlaceObject2_22_144/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // onClipEvent(enterFrame) {
    //   _parent._alpha -= 3.34;
    // }
    //
    // _parent here is DefineSprite_23 (the anim1 clip that owns this
    // child). Per tick we decrement anim1's alpha by 3.34/100 (Flash
    // 0-100 → TS 0-1 conversion).
    this.fadeDriverSym = {
      name: "fadeDriver",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_23/frame_109/PlaceObject2_22_144/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 3.34;
        const parent = clip.parent;
        if (parent) {
          parent.alpha -= 3.34 / 100;
        }
      },
    };

    // ---- anim1 — main 150-frame composite timeline ---------------
    // Mirrors DefineSprite_23's authored timeline.
    //
    // frame_1  (index 0):   SOMA.playSound("licrounch_1001")
    //   AS: DefineSprite_23/frame_1/DoAction.as
    //   (Sound fired at attach time via onSpellStart.)
    //
    // frame_37 (index 36):  SOMA.playSound("licrounch_1001b")
    //   AS: DefineSprite_23/frame_37/DoAction.as
    //
    // frame_109 (index 108): this.end() → signalHit; attach fadeDriver
    //   AS: DefineSprite_23/frame_109/DoAction.as
    //   PlaceObject2_22_144 placed at this frame — attach fadeDriverSym.
    //
    // frame_148 (index 147): _parent.removeMovieClip(); stop()
    //   AS: DefineSprite_23/frame_148/DoAction.as
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS: DefineSprite_23/frame_1/DoAction.as
            // SOMA.playSound("licrounch_1001") — fired at attach time
            // via onSpellStart; no additional action needed here.
          },
        ],
        [
          36,
          (_clip) => {
            // AS: DefineSprite_23/frame_37/DoAction.as
            // SOMA.playSound("licrounch_1001b")
            this.soundCallback?.("licrounch_1001b");
          },
        ],
        [
          108,
          (clip, ctx) => {
            // AS: DefineSprite_23/frame_109/DoAction.as
            // this.end() → damage popup at target
            this.runtime.signalHit();

            // Place PlaceObject2_22_144 — the fade-driver child clip
            // whose onClipEvent(enterFrame) decrements _parent._alpha.
            // AS: DefineSprite_23/frame_109/PlaceObject2_22_144/
            //     CLIPACTIONRECORD onClipEvent(enterFrame).as
            clip.attach(this.fadeDriverSym, "fadeDriver", 144, ctx);
          },
        ],
        [
          147,
          (clip) => {
            // AS: DefineSprite_23/frame_148/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fadeDriverSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("licrounch_1001");
    callbacks.playSound("licrounch_1001");

    // Capture sound callback for frame_37 script use.
    this.soundCallback = callbacks.playSound;

    // Attach the main animation clip at root. Mirrors the implicit
    // placement of DefineSprite_23 on the main SWF timeline (frame_1).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
