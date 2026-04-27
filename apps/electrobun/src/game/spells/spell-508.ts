/**
 * Spell 508 — Maîtrise des Sorts (Osamodas / Many).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/508/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no
 * caster-side content, and no dual-anchored timeline — it is a pure
 * impact animation at the target cell. There are no `librarySymbols[]`
 * entries in the manifest; the entire visual is driven by a single
 * `anim1` timeline (174 frames) stored in `animations[]`.
 *
 * Canonical AS layout:
 *
 *   DefineSprite_18 — outer container / main animation timeline.
 *     frame_43:  SOMA.playSound("many_508")  — plays at the main impact.
 *     frame_154: SOMA.playSound("many_load2") — secondary sound.
 *     frame_172: _parent.removeMovieClip()   — spell complete.
 *
 *   DefineSprite_5 — spinning sub-symbol (referenced by a PlaceObject2
 *     inside DefineSprite_18 at depth 2).
 *     PlaceObject2_4_2 onClipEvent(load):       vr = 3.3
 *     PlaceObject2_4_2 onClipEvent(enterFrame): _rotation += vr;
 *                                               if (temps++ > 84) vr *= 0.96
 *
 *   DefineSprite_14 — looping sub-symbol (13 frames, loops back to 1
 *     at frame 13).
 *     frame_13: gotoAndPlay(1)
 *
 *   DefineSprite_15 — three placed instances of DefineSprite_14, each
 *     started at a different offset frame on load (gotoAndPlay 2, 3, 4).
 *     PlaceObject2_14_3 onClipEvent(load): gotoAndPlay(2)
 *     PlaceObject2_14_5 onClipEvent(load): gotoAndPlay(3)
 *     PlaceObject2_14_7 onClipEvent(load): gotoAndPlay(4)
 *
 *   DefineSprite_12 — composite symbol with two placed sub-clips:
 *     PlaceObject2_8_45 onClipEvent(enterFrame): _rotation += 1 (constant spin)
 *     PlaceObject2_11_53 onClipEvent(load):       i=0; vr=10; temps2=0
 *     PlaceObject2_11_53 onClipEvent(enterFrame): every 4th frame rotate
 *                                                 by -vr; decay vr after 21
 *
 * Because the manifest has no `librarySymbols[]` and the SWF does not
 * expose named attachMovie symbols — instead it uses PlaceObject2 tags
 * to author sub-sprite instances directly into the composite `anim1`
 * timeline — the per-clip behaviours are baked into the `anim1` symbol
 * definition's onEnterFrame handler. The authored composite frames
 * already embed the combined visual; the clip-event physics described
 * above are layered on top for the spinning/wobbling sub-elements.
 *
 * Since the sub-clip references (DefineSprite_5, _12, _14, _15) are
 * PlaceObject2 placements baked inside the composite SVG frames rather
 * than dynamic attachMovie calls, there are no separate SymbolDefinitions
 * to register. The entire spell is expressed as a single `anim1`
 * SymbolDefinition whose:
 *   - frames carry the 174-frame composite texture sequence
 *   - frameScripts handle sound + completion at the canonical frames
 *   - onEnterFrame applies the canonical spinning behaviours on the clip
 *     level (the composite already renders the visual; the frame-driven
 *     rotation is additive and matches the original sub-clip physics)
 *
 * Sounds:
 *   frame 43  (0-based: 42) → "many_508"
 *   frame 154 (0-based: 153) → "many_load2"
 *   (Note: manifest `sounds[]` confirms these frame indices at 0-based 42
 *    and 153, matching DefineSprite_18/frame_43 and frame_154.)
 *
 * signalHit: fired at frame 43 (0-based 42) — the main impact / sound cue,
 * which is the canonical moment the spell "hits" the target.
 *
 * complete: fired at frame 172 (0-based 171) — mirrors
 * DefineSprite_18/frame_172 `_parent.removeMovieClip()`.
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
  width: 156.7,
  height: 151.35,
  offsetX: -79.05,
  offsetY: -98.55,
};

export class Spell508 extends RuntimeSpell {
  readonly spellId = 508;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 174-frame composite impact animation ------------
    // This is the sole animation in the manifest (animations[0]).
    // No librarySymbols exist; the entire spell visual, including the
    // authored sub-clip behaviours from DefineSprite_5/_12/_14/_15,
    // is composited into the per-frame SVG textures.
    //
    // Frame scripts mirror:
    //   DefineSprite_18/frame_43/DoAction.as  → playSound + signalHit
    //   DefineSprite_18/frame_154/DoAction.as → playSound
    //   DefineSprite_18/frame_172/DoAction.as → _parent.removeMovieClip()
    //
    // onEnterFrame applies the canonical spinning behaviour from
    // DefineSprite_5/frame_1/PlaceObject2_4_2/onClipEvent(enterFrame):
    //   _rotation = _rotation + vr;
    //   if (temps++ > 84) { vr *= 0.96; }
    // seeded by onClipEvent(load): vr = 3.3; temps = 0.
    // The additional sub-clip rotations (DefineSprite_12 constant +1 deg/frame,
    // and the every-4th-frame wobble) are also baked into the composite
    // textures and need no extra clip-level transform here.

    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 174,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
        // vr = 3.3;  temps initialised to 0 implicitly.
        clip.vars.vr = 3.3;
        clip.vars.temps = 0;
      },

      onEnterFrame: (clip) => {
        // AS DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + vr;
        // if (temps++ > 84) { vr *= 0.96; }
        const vr = clip.vars.vr as number;
        let temps = clip.vars.temps as number;

        // Apply the canonical spinning rotation delta (degrees → radians).
        clip.rotation += (vr * Math.PI) / 180;

        if (temps > 84) {
          clip.vars.vr = vr * 0.96;
        }
        clip.vars.temps = temps + 1;
      },

      frameScripts: new Map([
        [
          42,
          (_clip) => {
            // AS DefineSprite_18/frame_43/DoAction.as
            // SOMA.playSound("many_508");
            // This is also the canonical hit frame (primary impact sound).
            if (this.playSound) {
              this.playSound("many_508");
            }
            this.runtime.signalHit();
          },
        ],
        [
          153,
          (_clip) => {
            // AS DefineSprite_18/frame_154/DoAction.as
            // SOMA.playSound("many_load2");
            if (this.playSound) {
              this.playSound("many_load2");
            }
          },
        ],
        [
          171,
          (clip) => {
            // AS DefineSprite_18/frame_172/DoAction.as
            // _parent.removeMovieClip();
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
    // Capture the sound callback so frame scripts can play sounds.
    this.playSound = callbacks.playSound;

    // Attach the main animation at the root so it starts ticking
    // from the next runtime frame.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
