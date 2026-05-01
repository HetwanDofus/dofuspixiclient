/**
 * Spell 2115 — Shield Cara (Carapace / Shield spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2115/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a pure impact animation at the
 * target cell — no projectile, no caster reference. A single composite
 * animation (anim1, 129 frames) plays at the target, driven by two library
 * symbols managed inside DefineSprite_17.
 *
 * Canonical AS layout:
 *   - Main timeline / DefineSprite_17 (outer, 127 frames):
 *       frame_1:  SOMA.playSound("shield_cara")
 *       frame_127: _parent.removeMovieClip() → spell complete
 *     DefineSprite_17 holds authored sub-sprites DefineSprite_15 (sprite15,
 *     57-frame sparkle trail) placed at various depths/transforms across its
 *     timeline, plus a dynamic child via sprite14.
 *
 *   - lib_sprite15 (characterId 15, kind: "clipEvent", directlyDynamic: false):
 *       57-frame authored composite sparkle. No CLIPACTIONRECORD handlers of
 *       its own. frame_55/DoAction.as → stop(). It is placed multiple times
 *       within DefineSprite_17's timeline at various frames/depths/transforms
 *       with different ratios (staggered instances).
 *
 *   - lib_sprite14 (characterId 14, kind: "clipEvent", directlyDynamic: true):
 *       1-frame base shape with a CLIPACTIONRECORD onEnterFrame that spins it
 *       10 degrees/tick (_rotation += 10). It is placed inside DefineSprite_15
 *       (sprite15) at frame 0, depth 1, with an animated color tween across
 *       frames 0–48 of sprite15.
 *       scripts/DefineSprite_14/frame_1/PlaceObject2_3_2/
 *         CLIPACTIONRECORD onClipEvent(enterFrame).as:
 *           _rotation = _rotation + 10;
 *
 *   - DefineSprite_13 (not exposed as a library symbol in manifest — internal
 *     to the anim1 composite timeline):
 *       frame_1: _rotation = random(360)  — random initial rotation
 *       frame_28: stop()
 *
 * Since sprite15 is "directlyDynamic: false" (wrapper), its frameScripts attach
 * the dynamic sprite14 child. Since sprite14 is "directlyDynamic: true", it
 * carries the onEnterFrame spin handler.
 *
 * DefineSprite_17 is the outer shell that the main anim1 uses — we model it as
 * the main "anim1" symbol attached at root. Its 127-frame timeline drives
 * completion. The many sprite15 placements inside it are attached via its
 * frameScripts at the canonical placement frames.
 *
 * signalHit: fired early in the animation — frame_1 of the outer sprite is the
 * canonical impact moment (the shield snaps onto the target). We signal hit at
 * frame 0 (the entry script of anim1Sym).
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

// ---- Manifest bounds -------------------------------------------------------

const SPRITE14_BOUNDS = {
  width: 53.9,
  height: 23.85,
  offsetX: -41.15,
  offsetY: -12.5,
};

const SPRITE15_BOUNDS = {
  width: 60.4,
  height: 30.45,
  offsetX: -47.65,
  offsetY: -19.1,
};

// anim1 outer composite (DefineSprite_17 shell)
const ANIM1_BOUNDS = {
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell2115 extends RuntimeSpell {
  readonly spellId = 2115;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs so onSpellStart can attach them
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- lib_sprite14 — directlyDynamic: true, spinning inner shape ----
    // Placed inside sprite15 at frame 0, depth 1.
    // AS DefineSprite_14/frame_1/PlaceObject2_3_2/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = _rotation + 10;
    const sprite14Sym: SymbolDefinition = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      // No onClipEvent(load) in canonical AS — no onLoad needed.
      onEnterFrame: (clip) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_3_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _rotation = _rotation + 10;
        clip.rotation += (10 * Math.PI) / 180;
      },
    };

    // ---- lib_sprite15 — directlyDynamic: false, 57-frame sparkle wrapper ----
    // Wraps sprite14. frame_55/DoAction.as → stop().
    // Placed many times inside DefineSprite_17 (anim1Sym) at various frames/depths.
    //
    // frame_0 (entry): attach sprite14 at depth 1 with the canonical initial
    // placement matrix from placements[0]:
    //   translateX: -6.5, translateY: -6.6, scale 1×1, no rotation,
    //   colorTransform: full white (alphaMult 256 / redAdd 255 etc.) — the
    //   colour is purely a tween controlled by PlaceObject2 moves on the parent
    //   timeline; the runtime's composite rendering bakes those per-frame colour
    //   values into the SVG frames, so we just attach the live sprite14 at the
    //   canonical initial position and let its onEnterFrame spin it.
    const sprite15Sym: SymbolDefinition = {
      name: "sprite15",
      totalFrames: 57,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_15 frame_1: place sprite14 child at depth 1.
            // Canonical placement matrix (placements[0], parentSpriteId 15, frame 0):
            //   translateX: -6.5, translateY: -6.6
            clip.attach(sprite14Sym, "sprite14", 1, ctx, {
              x: -6.5,
              y: -6.6,
            });
          },
        ],
        [
          54,
          (clip) => {
            // AS DefineSprite_15/frame_55/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- anim1Sym — outer 127-frame shell (DefineSprite_17) ----
    // frame_1/DoAction.as: SOMA.playSound("shield_cara")  — handled in onSpellStart
    // frame_127/DoAction.as: _parent.removeMovieClip() → spell complete
    //
    // The many sprite15 placements inside DefineSprite_17 (from manifest
    // librarySymbols[1].placements where parentSpriteId === 17) are attached
    // at their respective canonical frames. We use the frameScripts map to
    // spawn each instance at the correct frame/depth/transform.
    //
    // Placement summary (parentSpriteId=17, kind="place", 0-indexed frame):
    //   frame 0,  depth 4:  matrix (scaleX 0.220, scaleY 0.560, skew, tx 23.75, ty -6.1), ratio 0
    //   frame 3,  depth 6:  matrix (scaleX 0.520, scaleY 0.183, skew, tx 15.7, ty 6.75), ratio 3
    //   frame 6,  depth 10: matrix (scaleX 0.591, scaleY 0.586, skew, tx 15.25, ty -1.1), ratio 6
    //   frame 9,  depth 8:  matrix (scaleX 0.832, scaleY 0.175, tx 1.5, ty 10.25), ratio 9
    //   frame 9,  depth 12: matrix (scaleX 0.068, scaleY 0.643, skew, tx 23.75, ty -22.15), ratio 9
    //   frame 12, depth 16: matrix (scaleX -0.520, scaleY 0.183, skew, tx -14.2, ty 6.95), ratio 12
    //   frame 15, depth 14: matrix (scaleX 0.832, scaleY 0.570, tx 1.5, ty 1.95), ratio 15
    //   frame 15, depth 18: matrix (scaleX 0.591, scaleY 0.677, skew, tx 16.25, ty -13.8), ratio 15
    //   frame 18, depth 20: matrix (scaleX -0.591, scaleY 0.586, skew, tx -13.7, ty -0.95), ratio 18
    //   frame 18, depth 22: matrix (scaleX 0.502, scaleY -0.594, skew, tx 14.7, ty -27.6), ratio 18
    //   frame 21, depth 24: matrix (scaleX 0.920, scaleY 0.791, tx 1.5, ty -12.05), ratio 21
    //   frame 24, depth 26: matrix (scaleX -0.194, scaleY 0.568, skew, tx -22.65, ty -6.15), ratio 24
    //   frame 24, depth 28: matrix (scaleX 0.520, scaleY -0.218, skew, tx 14.35, ty -36.2), ratio 24
    //   frame 27, depth 30: matrix (scaleX 0.832, scaleY -0.680, tx 0.75, ty -27.7), ratio 27
    //   frame 27, depth 32: matrix (scaleX -0.591, scaleY 0.677, skew, tx -14.75, ty -13.6), ratio 27
    //   frame 30, depth 34: matrix (scaleX 0.723, scaleY -0.360, tx 0.75, ty -38.95), ratio 30
    //   frame 33, depth 36: matrix (scaleX -0.502, scaleY -0.594, skew, tx -13.4, ty -27), ratio 33
    //   frame 36, depth 38: matrix (scaleX -0.520, scaleY -0.218, skew, tx -12.8, ty -36.05), ratio 36
    //   frame 36, depth 40: matrix (scaleX -0.097, scaleY 0.658, skew, tx -22.05, ty -21.35), ratio 36
    //
    // Scale and rotation from the matrix are encoded into the pre-rendered composite
    // SVG frames for the static visual; here we attach live sprite15 instances so
    // their contained sprite14 keeps spinning. We apply translateX/translateY from
    // the placement matrix as the initial position of each sprite15 instance.
    // (ScaleX/Y and rotateSkew from the matrix are baked into the composite SVGs —
    // we don't apply them to the live clip since that would double-transform the
    // rotation animation; the composite anim1 frames carry the authored visual.)

    const frameScriptsMap = new Map<
      number,
      (clip: ReturnType<typeof Object.create>, ctx: SpellContext) => void
    >();

    // frame 0 → depth 4, tx 23.75, ty -6.1
    frameScriptsMap.set(0, (clip, ctx) => {
      // AS DefineSprite_17/frame_1/DoAction.as: SOMA.playSound("shield_cara")
      // (Sound handled in onSpellStart before this runs — canonical order)
      // Place sprite15 instance at depth 4
      // AS placements[0]: frame 0, depth 4, matrix tx 23.75, ty -6.1
      clip.attach(sprite15Sym, "s15_d4", 4, ctx, {
        x: 23.75,
        y: -6.1,
      });
    });

    // frame 3 → depth 6, tx 15.7, ty 6.75
    frameScriptsMap.set(3, (clip, ctx) => {
      // AS placements[1]: frame 3, depth 6, matrix tx 15.7, ty 6.75
      clip.attach(sprite15Sym, "s15_d6", 6, ctx, {
        x: 15.7,
        y: 6.75,
      });
    });

    // frame 6 → depth 10, tx 15.25, ty -1.1
    frameScriptsMap.set(6, (clip, ctx) => {
      // AS placements[2]: frame 6, depth 10, matrix tx 15.25, ty -1.1
      clip.attach(sprite15Sym, "s15_d10", 10, ctx, {
        x: 15.25,
        y: -1.1,
      });
    });

    // frame 9 → depth 8 (tx 1.5, ty 10.25) AND depth 12 (tx 23.75, ty -22.15)
    frameScriptsMap.set(9, (clip, ctx) => {
      // AS placements[3]: frame 9, depth 8, matrix tx 1.5, ty 10.25
      clip.attach(sprite15Sym, "s15_d8", 8, ctx, {
        x: 1.5,
        y: 10.25,
      });
      // AS placements[4]: frame 9, depth 12, matrix tx 23.75, ty -22.15
      clip.attach(sprite15Sym, "s15_d12", 12, ctx, {
        x: 23.75,
        y: -22.15,
      });
    });

    // frame 12 → depth 16, tx -14.2, ty 6.95
    frameScriptsMap.set(12, (clip, ctx) => {
      // AS placements[5]: frame 12, depth 16, matrix tx -14.2, ty 6.95
      clip.attach(sprite15Sym, "s15_d16", 16, ctx, {
        x: -14.2,
        y: 6.95,
      });
    });

    // frame 15 → depth 14 (tx 1.5, ty 1.95) AND depth 18 (tx 16.25, ty -13.8)
    frameScriptsMap.set(15, (clip, ctx) => {
      // AS placements[6]: frame 15, depth 14, matrix tx 1.5, ty 1.95
      clip.attach(sprite15Sym, "s15_d14", 14, ctx, {
        x: 1.5,
        y: 1.95,
      });
      // AS placements[7]: frame 15, depth 18, matrix tx 16.25, ty -13.8
      clip.attach(sprite15Sym, "s15_d18", 18, ctx, {
        x: 16.25,
        y: -13.8,
      });
    });

    // frame 18 → depth 20 (tx -13.7, ty -0.95) AND depth 22 (tx 14.7, ty -27.6)
    frameScriptsMap.set(18, (clip, ctx) => {
      // AS placements[8]: frame 18, depth 20, matrix tx -13.7, ty -0.95
      clip.attach(sprite15Sym, "s15_d20", 20, ctx, {
        x: -13.7,
        y: -0.95,
      });
      // AS placements[9]: frame 18, depth 22, matrix tx 14.7, ty -27.6
      clip.attach(sprite15Sym, "s15_d22", 22, ctx, {
        x: 14.7,
        y: -27.6,
      });
    });

    // frame 21 → depth 24, tx 1.5, ty -12.05
    frameScriptsMap.set(21, (clip, ctx) => {
      // AS placements[10]: frame 21, depth 24, matrix tx 1.5, ty -12.05
      clip.attach(sprite15Sym, "s15_d24", 24, ctx, {
        x: 1.5,
        y: -12.05,
      });
    });

    // frame 24 → depth 26 (tx -22.65, ty -6.15) AND depth 28 (tx 14.35, ty -36.2)
    frameScriptsMap.set(24, (clip, ctx) => {
      // AS placements[11]: frame 24, depth 26, matrix tx -22.65, ty -6.15
      clip.attach(sprite15Sym, "s15_d26", 26, ctx, {
        x: -22.65,
        y: -6.15,
      });
      // AS placements[12]: frame 24, depth 28, matrix tx 14.35, ty -36.2
      clip.attach(sprite15Sym, "s15_d28", 28, ctx, {
        x: 14.35,
        y: -36.2,
      });
    });

    // frame 27 → depth 30 (tx 0.75, ty -27.7) AND depth 32 (tx -14.75, ty -13.6)
    frameScriptsMap.set(27, (clip, ctx) => {
      // AS placements[13]: frame 27, depth 30, matrix tx 0.75, ty -27.7
      clip.attach(sprite15Sym, "s15_d30", 30, ctx, {
        x: 0.75,
        y: -27.7,
      });
      // AS placements[14]: frame 27, depth 32, matrix tx -14.75, ty -13.6
      clip.attach(sprite15Sym, "s15_d32", 32, ctx, {
        x: -14.75,
        y: -13.6,
      });
    });

    // frame 30 → depth 34, tx 0.75, ty -38.95
    frameScriptsMap.set(30, (clip, ctx) => {
      // AS placements[15]: frame 30, depth 34, matrix tx 0.75, ty -38.95
      clip.attach(sprite15Sym, "s15_d34", 34, ctx, {
        x: 0.75,
        y: -38.95,
      });
    });

    // frame 33 → depth 36, tx -13.4, ty -27
    frameScriptsMap.set(33, (clip, ctx) => {
      // AS placements[16]: frame 33, depth 36, matrix tx -13.4, ty -27
      clip.attach(sprite15Sym, "s15_d36", 36, ctx, {
        x: -13.4,
        y: -27,
      });
    });

    // frame 36 → depth 38 (tx -12.8, ty -36.05) AND depth 40 (tx -22.05, ty -21.35)
    frameScriptsMap.set(36, (clip, ctx) => {
      // AS placements[17]: frame 36, depth 38, matrix tx -12.8, ty -36.05
      clip.attach(sprite15Sym, "s15_d38", 38, ctx, {
        x: -12.8,
        y: -36.05,
      });
      // AS placements[18]: frame 36, depth 40, matrix tx -22.05, ty -21.35
      clip.attach(sprite15Sym, "s15_d40", 40, ctx, {
        x: -22.05,
        y: -21.35,
      });
    });

    // frame 126 → _parent.removeMovieClip() + spell complete
    frameScriptsMap.set(126, (clip) => {
      // AS DefineSprite_17/frame_127/DoAction.as: _parent.removeMovieClip()
      clip.remove();
      this.runtime.complete();
    });

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 127,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: frameScriptsMap as ReadonlyMap<
        number,
        (clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void
      >,
    };

    this.registry.register(sprite14Sym);
    this.registry.register(sprite15Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_17/frame_1/DoAction.as: SOMA.playSound("shield_cara")
    callbacks.playSound("shield_cara");

    // Signal hit at spell impact — the shield appears immediately on the target.
    this.runtime.signalHit();

    // Attach the outer anim1 shell at root depth 1. This drives the full
    // 127-frame timeline including all sprite15 sub-placements.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
