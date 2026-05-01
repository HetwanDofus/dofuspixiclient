/**
 * Spell 606 — (Unknown name, likely a Feca/Osamodas shield-style effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/606/scripts/scripts/
 *
 * displayType=11 (TargetCell). The animation is a single self-contained
 * 150-frame composite (`anim1`) anchored at the target cell, with no
 * projectile motion, no caster reference, and no `move`/`shoot`/`duplicate`
 * library symbols. This maps cleanly to TargetCell.
 *
 * The main SWF timeline is DefineSprite_23 (150 frames):
 *   - frame_1:    no explicit DoAction; anim1 plays from the start.
 *   - frame_115:  PlaceObject2_6_2 has an onClipEvent(enterFrame) that
 *                 randomises _alpha and _rotation every tick on sprite7
 *                 (a secondary glow/flash element placed at that frame).
 *   - frame_148:  DoAction → _parent.removeMovieClip() (spell complete).
 *
 * sprite7 (characterId=7, librarySymbols[0]):
 *   - Single-frame visual (the glow/sparkle element).
 *   - directlyDynamic=true — owns its OWN CLIPACTIONRECORD onClipEvent(enterFrame):
 *       _alpha = random(20) + 80;
 *       _rotation = random(360);
 *   - Placed by DefineSprite_23 starting at frame 18 (kind="place") via a
 *     PlaceObject2 tween (frames 18-42 ramp alpha 5→256, scale grows).
 *     Also re-placed at frame 129 (kind="place") with alphaMult=5.
 *   - The PlaceObject2_6_2 enterFrame in DefineSprite_23/frame_115 applies
 *     the same alpha/rotation randomisation on the same depth-2 instance
 *     (i.e. the very same sprite7 instance already on stage). Both scripts
 *     describe identical behaviour so a single onEnterFrame handler on the
 *     SymbolDefinition is sufficient.
 *
 * DefineSprite_19 (inner loop sprite — NOT in librarySymbols, authored inline):
 *   - frame_1:  gotoAndPlay(random(9) + 2)  → jump to random frame 2-10
 *   - frame_4:  _rotation = random(360)
 *   - frame_28: gotoAndPlay(2)              → loop frames 2-28
 *   This sprite is entirely baked into the pre-rendered anim1 composite SVG
 *   frames and does NOT need a separate SymbolDefinition — it has no
 *   directlyDynamic placement entry, no lib_sprite19 textures, and the
 *   combat exporter has already composited it into anim1.
 *
 * Library symbols:
 *   - sprite7 (lib_sprite7) — single-frame glow/sparkle. onEnterFrame
 *     pulses alpha randomly in [80,100] and randomises rotation every tick.
 *     Attached at DefineSprite_23 frame 18 (index 17 zero-based), re-placed
 *     at frame 129 (index 128).
 *
 * Main timeline (DefineSprite_23):
 *   - anim1 plays through 150 frames.
 *   - sprite7 attached at frame 18, removed+re-placed at frame 129.
 *   - frame_148 (index 147): _parent.removeMovieClip() → runtime.complete().
 *
 * signalHit is fired at frame_115 (index 114) — the impact/glow frame where
 * the secondary spark effect begins.
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

const SPRITE7_BOUNDS = {
  width: 136.65,
  height: 122.8,
  offsetX: -68.3,
  offsetY: -61.4,
};

// Bounds for the main anim1 composite (used for the root anim1 symbol).
const ANIM1_BOUNDS = {
  width: 121.6,
  height: 144.5,
  offsetX: -92.05,
  offsetY: -134.35,
};

export class Spell606 extends RuntimeSpell {
  readonly spellId = 606;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold a reference so onSpellStart can attach anim1 + sprite7.
  private anim1Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- sprite7 — single-frame glow/sparkle (directlyDynamic=true) ----
    //
    // AS: scripts/DefineSprite_7/frame_1/PlaceObject2_6_1/
    //         CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   onClipEvent(enterFrame){
    //      _alpha = random(20) + 80;
    //      _rotation = random(360);
    //   }
    //
    // Also identical behaviour is described by:
    //   scripts/DefineSprite_23/frame_115/PlaceObject2_6_2/
    //       CLIPACTIONRECORD onClipEvent(enterFrame).as
    // (same depth-2 instance of sprite7 already on stage from frame 18).
    // A single onEnterFrame handler covers both.
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,

      onEnterFrame: (clip) => {
        // AS: _alpha = random(20) + 80;   (0-100 → 0-1)
        clip.alpha = (Math.floor(Math.random() * 20) + 80) / 100;
        // AS: _rotation = random(360);    (degrees → radians)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },
    };

    // ---- anim1 — 150-frame main composite ----
    //
    // This is the top-level authored timeline (DefineSprite_23 in the SWF).
    // It carries the full visual progression of the spell. We model it as a
    // SymbolDefinition so the root clip can host it as a named child and its
    // frameScripts can fire the attachment of sprite7 and the completion signal.
    //
    // Frame indexing (0-based):
    //   frame 17  (AS frame_18)  : attach sprite7 at depth 2 — first "place" placement.
    //   frame 114 (AS frame_115) : signalHit (impact/glow flash begins).
    //   frame 128 (AS frame_129) : re-attach sprite7 at depth 2 — second "place"
    //                              placement (alphaMult=5, fade-out restart).
    //   frame 147 (AS frame_148) : _parent.removeMovieClip() → complete().
    //
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          // AS DefineSprite_23 frame_18: PlaceObject2 places sprite7 at depth 2.
          // Initial placement matrix: translateX=1.6, translateY=-103.7,
          // scaleX=-0.157 (mirrored), alphaMult=5/256 ≈ 0.02.
          17,
          (clip, ctx) => {
            // Attach sprite7 at depth 2 with the canonical frame-18 transform.
            // scaleX is negative in the SWF (horizontal mirror); we honour that.
            // alphaMult=5 out of 256 → ≈ 0.02. The onEnterFrame will immediately
            // override alpha each tick, so this is just the initial flash-in state.
            const s7 = clip.attach(this.sprite7Sym, "sprite7_d2", 2, ctx, {
              x: 1.6,
              y: -103.7,
            });
            s7.scaleX = -0.15673828125;
            s7.scaleY = 0.15673828125;
            s7.alpha = 5 / 256;
          },
        ],
        [
          // AS DefineSprite_23 frame_115: onClipEvent(enterFrame) starts firing
          // on sprite7 (depth 2). signalHit fires here — the glow burst frame.
          114,
          (_clip) => {
            // AS: (indirectly) damage popup / hit callback.
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_23 frame_129: second "place" for sprite7 at depth 2.
          // alphaMult=5, same scale as frame_42's final value (0.3223).
          // We remove the existing instance and re-attach to mirror "place" semantics.
          128,
          (clip, ctx) => {
            // Remove the current depth-2 instance (mirrors PlaceObject2 with ratio).
            const existing = clip.children.get("sprite7_d2");
            if (existing) {
              existing.remove();
            }
            const s7 = clip.attach(this.sprite7Sym, "sprite7_d2", 2, ctx, {
              x: 1.45,
              y: -106.55,
            });
            s7.scaleX = -0.3223114013671875;
            s7.scaleY = 0.3223114013671875;
            s7.alpha = 5 / 256;
          },
        ],
        [
          // AS DefineSprite_23 frame_148/DoAction.as:
          //   _parent.removeMovieClip();
          // The outer mc IS our root, so this triggers spell completion.
          147,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite7Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_1: no SOMA.playSound found in the provided scripts.
    // Attach the main anim1 composite at the root so its 150-frame timeline
    // starts ticking immediately.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
