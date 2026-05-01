/**
 * Spell 614 — Dodge (Cra / generic dodge animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/614/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single composite animation
 * (anim1, 102 frames) anchored at the target cell. There are no
 * move/shoot/projectile symbols and no caster-relative children, so
 * TargetCell is the correct choice.
 *
 * Library symbols (all placed within the outer DefineSprite_11 timeline):
 *
 *   - sprite8  (characterId 8, directlyDynamic: true, 81 frames)
 *               Inner animated bar. Has an enterFrame handler on a child
 *               clip (PlaceObject2_5_2 depth 2) that randomises alpha
 *               each tick. frame_73 → stop(). Placed inside sprite9.
 *
 *   - sprite9  (characterId 9, directlyDynamic: true, 1 frame)
 *               Wrapper that holds 8 sprite8 instances at various skewed
 *               transforms. Its own enterFrame (PlaceObject2_8_1 depth 1
 *               inside sprite9's frame_1) randomises rotation slightly
 *               each tick. Placed inside sprite10 at frame 0, depth 1,
 *               with a matrix transform.
 *
 *   - sprite10 (characterId 10, directlyDynamic: false, 27 frames)
 *               A wrapper that holds sprite9 instances at various depths
 *               and applies a long colour/scale tween from frame 0 to 24.
 *               frame_25 → stop(). Placed inside DefineSprite_11 at
 *               frame 15 (0-indexed).
 *
 * The outer DefineSprite_11 has 102 frames:
 *   - frame_13 (index 12): SOMA.playSound("dodge_607b")   [from sounds[] + frame AS]
 *   - frame_22 (index 21): SOMA.playSound("dodge_614")    [from sounds[] + frame AS]
 *   - frame_100 (index 99): _parent.removeMovieClip()  → runtime.complete()
 *
 * The main animation (anim1) supplies the 102-frame pre-rendered composite
 * for the outer timeline.  The two dynamic clipEvent symbols (sprite8 +
 * sprite9) are registered as library symbols and attached by their parent
 * frameScripts/onSpellStart so their per-tick handlers actually run.
 *
 * signalHit: fired from the outer sprite11 frame_22 (the "dodge_614"
 * sound frame) since that is the canonical impact moment.
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

// ---- Manifest bounds for library symbols ----

const SPRITE8_BOUNDS = {
  width: 70.25,
  height: 9.1,
  offsetX: -1.45,
  offsetY: -6.25,
};

const SPRITE9_BOUNDS = {
  width: 70.25,
  height: 9.1,
  offsetX: -1.5,
  offsetY: -6.25,
};

const SPRITE10_BOUNDS = {
  width: 273.1,
  height: 102.75,
  offsetX: -136.5,
  offsetY: -32.05,
};

// Outer animation (anim1) bounds — used to anchor the root display clip.
const ANIM1_BOUNDS = {
  width: 378.75,
  height: 473.15,
  offsetX: -188.85,
  offsetY: -343.05,
};

export class Spell614 extends RuntimeSpell {
  readonly spellId = 614;
  readonly displayType = SpellDisplayType.TargetCell;

  // Held so onSpellStart can attach sprite10 and frameScripts can
  // play sounds / complete.
  private sprite8Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  // Captured so frame scripts can reference it without holding callbacks.
  private _playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ----------------------------------------------------------------
    // sprite8 — directlyDynamic: true, 81 frames
    //
    // Canonical placement: inside sprite9 at frame 0, depth 1
    //   (single placement with matrix {scaleX:1, scaleY:1, translateX:-0.05, translateY:0})
    //
    // Two dynamic handlers live here:
    //   - DefineSprite_8/frame_1/PlaceObject2_5_2/onClipEvent(enterFrame):
    //       _alpha = random(100) + 20;
    //     This applies to "depth 2" child of sprite8's timeline which is
    //     the animated bar graphic.  In our model the texture frames of
    //     sprite8 already contain that bar, so we honour the intent by
    //     applying alpha randomisation to the sprite8 clip itself.
    //
    //   - DefineSprite_8/frame_73/DoAction.as: stop();
    // ----------------------------------------------------------------
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 81,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,

      // AS: DefineSprite_8/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
      // _alpha = random(100) + 20;
      onEnterFrame: (clip) => {
        clip.alpha = (Math.floor(Math.random() * 100) + 20) / 100;
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_8/frame_73/DoAction.as  → stop()
          72,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite9 — directlyDynamic: true, 1 frame
    //
    // Canonical placement: inside sprite10 at frame 0, depth 1
    //   with the complex skewed matrix from placements[0].
    //
    // sprite9's OWN enterFrame handler (PlaceObject2_8_1 depth 1):
    //   AS: DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //       _rotation = 2 * (-0.5 + Math.random());
    //
    // sprite9 also CONTAINS sprite8 (placed at frame 0, depth 1 inside
    // sprite9 per placements[]).  We attach sprite8 from sprite9's
    // frameScripts[0].
    //
    // There are 8 sprite9 instances placed in sprite10 at frame 0
    // (depths 1,3,5,7,9,11,13,15) with different transforms — those
    // attaches happen from sprite10's frameScripts[0].
    // ----------------------------------------------------------------
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,

      // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      // _rotation = 2 * (-0.5 + Math.random());
      onEnterFrame: (clip) => {
        clip.rotation = ((2 * (-0.5 + Math.random())) * Math.PI) / 180;
      },

      frameScripts: new Map([
        [
          // frame_1 (index 0): place sprite8 at depth 1 with identity-ish matrix
          // AS: PlaceObject2 places characterId 8 at depth 1, matrix
          //     {scaleX:1, scaleY:1, rotateSkew0:0, rotateSkew1:0, translateX:-0.05, translateY:0}
          0,
          (clip, ctx) => {
            clip.attach(this.sprite8Sym, "sprite8_d1", 1, ctx, {
              x: -0.05,
              y: 0,
            });
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite10 — directlyDynamic: false, 27 frames
    //
    // Canonical placement: inside DefineSprite_11 at frame 15 (0-indexed),
    // depth 1, with a colour-tween that fades in from alphaMult=87 to 256
    // over many frames.
    //
    // frame_25 (index 24): stop()
    //
    // At frame 0 (index 0): attaches 8 sprite9 instances at depths
    // 1,3,5,7,9,11,13,15 each with their authored matrix.
    //
    // The placements[] list for sprite9 inside sprite10 lists 8 x "place"
    // entries all at frame 0 with different depths and matrices.  After
    // that there are "move" entries (frames 1-24) updating each depth's
    // matrix — these are the tween keyframes. Because there are 25 frames
    // × 8 depths of tween data and the motion is smooth we implement the
    // tweened per-frame matrix updates using the onEnterFrame approach,
    // interpolating between the frame-0 ("place") transform and the final
    // frame-24 ("move") transform of each depth based on currentFrame.
    //
    // For simplicity and 1:1 correctness we port only the initial
    // placement transforms (which are already encoded in the pre-rendered
    // lib_sprite10 textures) and let the sprite9 children play normally;
    // the overall visual effect is driven by the composite lib_sprite10
    // frames that already capture the tween.  The sprite9 children are
    // attached so their dynamic handlers (rotation randomisation, alpha
    // flicker) run live on top of the pre-rendered base.
    // ----------------------------------------------------------------
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 27,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,

      frameScripts: new Map([
        [
          // frame_1 (index 0): attach all 8 sprite9 instances with their
          // canonical "place" matrices from placements[].
          //
          // AS: 8 × PlaceObject2 of characterId 9 (sprite9) at frame 0
          //     of sprite10, depths 1/3/5/7/9/11/13/15.
          0,
          (clip, ctx) => {
            // Depth 1: {scaleX:-1.3455, scaleY:0.9755, rotateSkew0:0.4344, rotateSkew1:0.2165, tx:-12.65, ty:2.4}
            const s9d1 = clip.attach(
              this.sprite9Sym,
              "sprite9_d1",
              1,
              ctx,
              { x: -12.65, y: 2.4 }
            );
            s9d1.scaleX = -1.3455963134765625;
            s9d1.scaleY = 0.975555419921875;
            s9d1.rotation = Math.atan2(0.216552734375, -1.3455963134765625);

            // Depth 3: {scaleX:-0.9883, scaleY:1.006, rotateSkew0:-0.078, rotateSkew1:-0.0489, tx:-11.85, ty:-0.05}
            const s9d3 = clip.attach(
              this.sprite9Sym,
              "sprite9_d3",
              3,
              ctx,
              { x: -11.85, y: -0.05 }
            );
            s9d3.scaleX = -0.9883270263671875;
            s9d3.scaleY = 1.0060577392578125;
            s9d3.rotation = Math.atan2(-0.0489654541015625, -0.9883270263671875);

            // Depth 5: {scaleX:-0.8668, scaleY:0.8854, rotateSkew0:0.5770, rotateSkew1:0.4003, tx:-10.4, ty:4.2}
            const s9d5 = clip.attach(
              this.sprite9Sym,
              "sprite9_d5",
              5,
              ctx,
              { x: -10.4, y: 4.2 }
            );
            s9d5.scaleX = -0.86688232421875;
            s9d5.scaleY = 0.8854217529296875;
            s9d5.rotation = Math.atan2(0.40032958984375, -0.86688232421875);

            // Depth 7: {scaleX:-1.648, scaleY:2.7315, rotateSkew0:0.8798, rotateSkew1:0.6063, tx:-12.65, ty:2.4}
            const s9d7 = clip.attach(
              this.sprite9Sym,
              "sprite9_d7",
              7,
              ctx,
              { x: -12.65, y: 2.4 }
            );
            s9d7.scaleX = -1.648956298828125;
            s9d7.scaleY = 2.731536865234375;
            s9d7.rotation = Math.atan2(0.6063385009765625, -1.648956298828125);

            // Depth 9: {scaleX:1.3631, scaleY:0.9883, rotateSkew0:0.4034, rotateSkew1:-0.1487, tx:12.6, ty:2.05}
            const s9d9 = clip.attach(
              this.sprite9Sym,
              "sprite9_d9",
              9,
              ctx,
              { x: 12.6, y: 2.05 }
            );
            s9d9.scaleX = 1.3631744384765625;
            s9d9.scaleY = 0.988372802734375;
            s9d9.rotation = Math.atan2(-0.1487884521484375, 1.3631744384765625);

            // Depth 11: {scaleX:0.9744, scaleY:1.0123, rotateSkew0:-0.1037, rotateSkew1:0.1164, tx:11.65, ty:-0.4}
            const s9d11 = clip.attach(
              this.sprite9Sym,
              "sprite9_d11",
              11,
              ctx,
              { x: 11.65, y: -0.4 }
            );
            s9d11.scaleX = 0.9744415283203125;
            s9d11.scaleY = 1.0123291015625;
            s9d11.rotation = Math.atan2(0.116455078125, 0.9744415283203125);

            // Depth 13: {scaleX:0.8982, scaleY:0.9022, rotateSkew0:0.5593, rotateSkew1:-0.337, tx:10.45, ty:3.9}
            const s9d13 = clip.attach(
              this.sprite9Sym,
              "sprite9_d13",
              13,
              ctx,
              { x: 10.45, y: 3.9 }
            );
            s9d13.scaleX = 0.8982696533203125;
            s9d13.scaleY = 0.9022369384765625;
            s9d13.rotation = Math.atan2(-0.3370513916015625, 0.8982696533203125);

            // Depth 15: {scaleX:1.6939, scaleY:2.7674, rotateSkew0:0.8444, rotateSkew1:-0.4166, tx:12.6, ty:2.05}
            const s9d15 = clip.attach(
              this.sprite9Sym,
              "sprite9_d15",
              15,
              ctx,
              { x: 12.6, y: 2.05 }
            );
            s9d15.scaleX = 1.6939544677734375;
            s9d15.scaleY = 2.767425537109375;
            s9d15.rotation = Math.atan2(-0.4166107177734375, 1.6939544677734375);
          },
        ],

        [
          // AS: DefineSprite_10/frame_25/DoAction.as → stop()
          24,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // anim1 — the outer 102-frame composite timeline (DefineSprite_11).
    //
    // This is the main-timeline animation that plays the full dodge
    // visual. It has frame scripts at indices 12, 21, and 99 (AS frames
    // 13, 22, 100).  It also places sprite10 at frame 15 (0-indexed).
    //
    // Because anim1 is the root-level content (no attachMovie call —
    // it IS the top-level clip), we model it as a symbol and attach it
    // from onSpellStart.
    // ----------------------------------------------------------------
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 102,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          // AS: DefineSprite_11/frame_13/DoAction.as → SOMA.playSound("dodge_607b")
          12,
          (_clip) => {
            this._playSound?.("dodge_607b");
          },
        ],

        [
          // AS: DefineSprite_11/frame_22/DoAction.as → SOMA.playSound("dodge_614")
          // Also the canonical hit moment.
          21,
          (_clip) => {
            this._playSound?.("dodge_614");
            this.runtime.signalHit();
          },
        ],

        [
          // Attach sprite10 at frame 15 (0-indexed), depth 1.
          // AS: PlaceObject2 places sprite10 (characterId 10) at depth 1
          //     in DefineSprite_11 at frame 15, with matrix
          //     {scaleX:1.3866, scaleY:2.3451, translateX:0.45, translateY:-35.7}
          //     and colorTransform {alphaMult:87} (alpha = 87/256 ≈ 0.34).
          15,
          (clip, ctx) => {
            const s10 = clip.attach(
              this.sprite10Sym,
              "sprite10_d1",
              1,
              ctx,
              { x: 0.45, y: -35.7 }
            );
            s10.scaleX = 1.3866424560546875;
            s10.scaleY = 2.3451385498046875;
            // alphaMult=87 out of 256
            s10.alpha = 87 / 256;
          },
        ],

        [
          // AS: DefineSprite_11/frame_100/DoAction.as → _parent.removeMovieClip()
          99,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture playSound for use from frame scripts (which don't have
    // direct access to the callbacks object).
    this._playSound = callbacks.playSound;

    // The canonical SWF main timeline implicitly places anim1 (the outer
    // DefineSprite_11 composite) on the stage at frame 1. Attach it to
    // the root so its timeline starts ticking from the first runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
