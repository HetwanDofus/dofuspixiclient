/**
 * Spell 2108 — Grina (Masqueraider / Pandawa area, "Grina" grinding attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2108/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster-side
 * content, and no dual-anchored world-absolute placement — just a single
 * composite animation anchored at the target cell. The outer sprite
 * (DefineSprite_23) plays to frame 103 then calls
 * `_parent.removeMovieClip()`.
 *
 * Library symbols:
 *   - sprite15 (DefineSprite_15) — single-frame spinning sub-element.
 *     onEnterFrame: `_rotation += 1.6` (degrees/tick → radians/tick).
 *     Placed inside sprite22 at depth 1 with a rotation/skew matrix.
 *     Three instances are placed via PlaceObject2 inside sprite22, each
 *     with an onClipEvent(load) that randomises the starting frame via
 *     `gotoAndPlay(random(_totalframes + 1))`.
 *
 *   - sprite22 (DefineSprite_22) — composite wrapper that contains three
 *     sprite15 instances. Its own frame_1 script is a random phase-jump
 *     (`gotoAndPlay(random(_totalframes + 1))`). The arakne renderer has
 *     pre-baked the static composite into lib_sprite22_0.svg but the three
 *     sprite15 children must be attached live so their per-tick rotation
 *     and individual phase randomisation actually run.
 *     The outer DefineSprite_23 fades sprite22 in/out over its 103-frame
 *     timeline via colour-transform alpha keyframes on the placement.
 *     We approximate the fade with a per-frame alpha update driven by the
 *     keyframe schedule from manifest.librarySymbols[1].placements[].
 *
 *   - sprite21 (DefineSprite_21) — inner sub-element of sprite22.
 *     frame_1: `_rotation = -random(180)` (random initial rotation).
 *     This is the sprite placed THREE TIMES inside sprite22's timeline
 *     (PlaceObject2 depths 3, 7, 11) with separate onClipEvent(load)
 *     handlers each doing `gotoAndPlay(random(_totalframes + 1))`.
 *     The sprite15 symbol wraps sprite21 (characterId 15 places
 *     characterId 14/21 — see DefineSprite_15 placing PlaceObject2_14_1).
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("grina_701").
 *
 * Completion: DefineSprite_23/frame_103/DoAction.as → _parent.removeMovieClip().
 * signalHit: fired at frame 13 of sprite23 (first full-alpha keyframe at
 *   manifest frame 12 → runtime 0-based frame 12, which is DefineSprite_23
 *   timeline frame index 12).
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

// --- Manifest bounds ---

const SPRITE15_BOUNDS = {
  width: 85.7,
  height: 85.7,
  offsetX: -42.85,
  offsetY: -42.85,
};

const SPRITE22_BOUNDS = {
  width: 143.5,
  height: 68.1,
  offsetX: -64.35,
  offsetY: -34.05,
};

// sprite21 (DefineSprite_21) is the inner element placed inside sprite22.
// It does not appear in manifest.librarySymbols directly but its behaviour
// (random initial rotation) comes from DefineSprite_21/frame_1/DoAction.as.
// We re-use sprite15's single-frame texture as the visual — sprite15 IS
// the outer wrapper that places one sprite21 instance (PlaceObject2_14_1).
// For the three sprite15 instances placed inside sprite22, each carries
// an onClipEvent(load) that randomises the playhead.
//
// The alpha fade schedule for sprite22 inside sprite23 (from manifest
// placements[]):
//   frame 0  → alphaMult 56/256
//   frame 1  → 73/256
//   frame 2  → 89/256
//   frame 3  → 106/256
//   frame 4  → 122/256
//   frame 5  → 139/256
//   frame 6  → 155/256
//   frame 7  → 172/256
//   frame 8  → 188/256
//   frame 9  → 205/256
//   frame 12 → 256/256  (= 1.0, fully opaque)
//   frames 13-87 → 1.0 (no move records → stays at 1.0)
//   frame 88 → 235/256
//   frame 89 → 213/256
//   frame 90 → 192/256
//   frame 91 → 171/256
//   frame 92 → 149/256
//   frame 93 → 128/256
//   frame 94 → 107/256
//   frame 95 → 85/256
//   frame 96 → 64/256
//   frame 97 → 43/256
//   frame 98 → 21/256
//   frame 99 → 0/256
// We drive this from sprite23's onEnterFrame on the sprite22 child clip.

// Build a typed lookup for the alpha keyframes (0-indexed parent frame).
const ALPHA_KEYFRAMES: ReadonlyMap<number, number> = new Map([
  [0, 56 / 256],
  [1, 73 / 256],
  [2, 89 / 256],
  [3, 106 / 256],
  [4, 122 / 256],
  [5, 139 / 256],
  [6, 155 / 256],
  [7, 172 / 256],
  [8, 188 / 256],
  [9, 205 / 256],
  [12, 256 / 256],
  [88, 235 / 256],
  [89, 213 / 256],
  [90, 192 / 256],
  [91, 171 / 256],
  [92, 149 / 256],
  [93, 128 / 256],
  [94, 107 / 256],
  [95, 85 / 256],
  [96, 64 / 256],
  [97, 43 / 256],
  [98, 21 / 256],
  [99, 0 / 256],
]);

/**
 * Interpolate the alpha of the sprite22 child for the given
 * (0-indexed) parent timeline frame. Uses the keyframe table above;
 * between keyframes the last known value is held (Flash "no easing"
 * between move records when no motion tween is present — the manifest
 * shows alphaMult jumping between fixed values, not a continuous
 * tween).
 */
function alphaForFrame(frame: number): number | null {
  // Direct hit
  if (ALPHA_KEYFRAMES.has(frame)) {
    return ALPHA_KEYFRAMES.get(frame)!;
  }
  return null;
}

export class Spell2108 extends RuntimeSpell {
  readonly spellId = 2108;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold a reference so sprite23's onEnterFrame can mutate sprite22's alpha.
  private sprite22Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE22_BOUNDS);

    // ----------------------------------------------------------------
    // sprite15 (DefineSprite_15) — single-frame spinning element.
    //
    // DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD
    //   onClipEvent(enterFrame).as:
    //     _rotation = _rotation + 1.6;
    //
    // The three PlaceObject2_21_{3,7,11} entries inside DefineSprite_22
    // each have an onClipEvent(load):
    //     gotoAndPlay(random(_totalframes + 1));
    // We model each placed sprite15 instance as an independent clip
    // whose onLoad randomises its starting frame and whose onEnterFrame
    // spins it.  The totalFrames for sprite15 is 1 (single authored
    // frame) — random(_totalframes + 1) = random(2) → 0 or 1, which
    // both land at frame 0 in the runtime (single-frame symbol always
    // stays on frame 0). The meaningful effect is the random phase
    // seeding (for multi-frame symbols); here the spin is the primary
    // behaviour.
    // ----------------------------------------------------------------
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_22/frame_1/PlaceObject2_21_{3,7,11}/
        //   CLIPACTIONRECORD onClipEvent(load).as:
        //   gotoAndPlay(random(_totalframes + 1));
        // totalFrames=1 → random(2) → [0,1]. Both map to frame index 0
        // in our 0-based runtime (single-frame clip). The call is kept
        // 1:1 for correctness if totalFrames ever changes.
        const total = clip.totalFrames;
        const target = Math.floor(Math.random() * (total + 1));
        clip.gotoAndPlay(Math.min(target, total - 1));
      },

      onEnterFrame: (clip) => {
        // AS DefineSprite_15/frame_1/PlaceObject2_14_1/
        //   CLIPACTIONRECORD onClipEvent(enterFrame).as:
        //   _rotation = _rotation + 1.6;
        // AS degrees → TS radians.
        clip.rotation += (1.6 * Math.PI) / 180;
      },
    };

    // ----------------------------------------------------------------
    // sprite22 (DefineSprite_22) — composite wrapper containing three
    // sprite15 instances placed at depths 3, 7, 11 (PlaceObject2_21_3,
    // PlaceObject2_21_7, PlaceObject2_21_11 inside frame_1 of sprite22).
    //
    // DefineSprite_22 has its own frame_1 script sourced from
    // DefineSprite_13/frame_1/DoAction.as which is shared with another
    // sprite:
    //   gotoAndPlay(random(47) + 2);
    // This randomises the playhead on entry. DefineSprite_13/frame_52:
    //   gotoAndPlay(2);  → loop back.
    //
    // sprite22 also has `lib_sprite22_0.svg` as a static backdrop frame,
    // but the three live sprite15 children supply the dynamic spin effect.
    //
    // The manifest placements for sprite22 inside sprite23 carry an
    // alphaMult colour-transform schedule. We drive that from sprite23's
    // onEnterFrame below.
    // ----------------------------------------------------------------

    // The matrix for each of the three sprite15 placements inside sprite22
    // (all three use the same matrix per manifest):
    //   scaleX=0.757843, scaleY=0.386948, rotateSkew0=-0.407883,
    //   rotateSkew1=0.743881, translateX=0, translateY=0
    // Decompose rotation = atan2(rotateSkew0, scaleX):
    const matrixA = 0.757843017578125;
    const matrixB = -0.4078826904296875; // rotateSkew0
    const matrixC = 0.7438812255859375;  // rotateSkew1
    const matrixD = 0.3869476318359375;
    const placedRotation = Math.atan2(matrixB, matrixA);
    const placedScaleX = Math.sqrt(matrixA * matrixA + matrixB * matrixB);
    const placedScaleY = Math.sqrt(matrixC * matrixC + matrixD * matrixD);
    // Check determinant for possible reflection.
    const det = matrixA * matrixD - matrixB * matrixC;
    const finalScaleY = det < 0 ? -placedScaleY : placedScaleY;

    this.sprite22Sym = {
      name: "sprite22",
      totalFrames: 52,
      frames: textures.getFrames("lib_sprite22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_13/frame_1/DoAction.as (shared with sprite22):
            //   gotoAndPlay(random(47) + 2);
            // 0-based: random(47)+2 ranges [2,48]; gotoAndPlay(N-1) → [1,47].
            const target = Math.floor(Math.random() * 47) + 2;
            clip.gotoAndPlay(target - 1);

            // Place the three sprite15 instances at depths 3, 7, 11.
            // Canonical: PlaceObject2_21_3, PlaceObject2_21_7,
            //            PlaceObject2_21_11 inside DefineSprite_22/frame_1.
            // Each carries onClipEvent(load) handled inside sprite15Sym.onLoad.
            const applyMatrix = (child: ReturnType<typeof clip.attach>) => {
              child.rotation = placedRotation;
              child.scaleX = placedScaleX;
              child.scaleY = finalScaleY;
              child.x = 0;
              child.y = 0;
            };

            const c3 = clip.attach(this.sprite15Sym, "s15_depth3", 3, ctx);
            applyMatrix(c3);

            const c7 = clip.attach(this.sprite15Sym, "s15_depth7", 7, ctx);
            applyMatrix(c7);

            const c11 = clip.attach(this.sprite15Sym, "s15_depth11", 11, ctx);
            applyMatrix(c11);
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_13/frame_52/DoAction.as:
            //   gotoAndPlay(2);
            // 0-based: gotoAndPlay(2-1) = gotoAndPlay(1).
            clip.gotoAndPlay(1);
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite23 (DefineSprite_23) — the outermost container for this
    // spell. 103 frames. Places sprite22 at depth 1 with an alpha-tween
    // schedule. Frame 103 → _parent.removeMovieClip().
    //
    // We model sprite23 as a container-only symbol (its authored visual
    // content is the full anim1 composite). We attach it at root in
    // onSpellStart and drive:
    //   - sprite22 alpha from the keyframe schedule
    //   - hit signal at the first fully-opaque frame (frame index 12)
    //   - completion at frame 102 (AS frame_103, 0-based = 102)
    // ----------------------------------------------------------------
    const sprite23Sym: SymbolDefinition = {
      name: "sprite23",
      totalFrames: 103,
      // The full anim1 sequence IS the authored output of sprite23.
      frames: textures.getFrames("anim1"),
      anchorX: sprite22Anchor.x, // same bounds as anim1
      anchorY: sprite22Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sprite22 at depth 1 with initial alpha.
            const child = clip.attach(this.sprite22Sym, "sprite22", 1, ctx);
            // Initial colorTransform: alphaMult=56/256 (frame 0 keyframe).
            child.alpha = 56 / 256;
            clip.vars.s22child = child;
            // Track current frame index for alpha interpolation.
            clip.vars.frameIdx = 0;
          },
        ],
        [
          12,
          () => {
            // First fully-opaque keyframe (alphaMult=256/256).
            // Signal the hit at this point — the aura is now fully visible.
            this.runtime.signalHit();
          },
        ],
        [
          102,
          (clip) => {
            // AS DefineSprite_23/frame_103/DoAction.as:
            //   _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),

      onEnterFrame: (clip) => {
        // Track the current frame index so we can apply alpha keyframes.
        // sprite23's currentFrame advances each tick; we read it to look up
        // the alpha schedule.
        const frameIdx = clip.currentFrame;
        const alpha = alphaForFrame(frameIdx);
        if (alpha !== null) {
          const child = clip.vars.s22child as
            | { alpha: number }
            | undefined;
          if (child) {
            child.alpha = alpha;
          }
        }
      },
    };

    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite22Sym);
    this.registry.register(sprite23Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("grina_701");
    callbacks.playSound("grina_701");

    // Attach the outermost sprite23 at the root at depth 1.
    // The harness has already set up the TargetCell anchor; sprite23
    // sits at (0,0) within the container (= target cell).
    const sprite23Sym = this.registry.resolve("sprite23");
    if (sprite23Sym) {
      this.root.attach(sprite23Sym, "sprite23", 1, context);
    }
  }
}
