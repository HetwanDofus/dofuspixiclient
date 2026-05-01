/**
 * Spell 407 — Explosion (likely Feca or generic explosion spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/407/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no caster reference,
 * no "move"/"shoot"/"duplicate" symbol — the spell is a single impact animation
 * at the target cell. The single `anim1` animation in `animations[]` (not in
 * `librarySymbols[]`) drives the visual. A secondary sprite (DefineSprite_6)
 * with randomised rotation/scale is placed as a compositing layer; it stops at
 * frame 52. The outermost sprite (DefineSprite_7) removes itself at frame 94,
 * signalling completion.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 * The single animation `anim1` lives in `animations[]` only.
 *
 * Sprites:
 *   - DefineSprite_7 (outer / anim1): 96 frames (0-indexed 0–95).
 *       frame_94 (index 93): _parent.removeMovieClip() → spell complete.
 *   - DefineSprite_6 (inner decorative layer, 52 frames):
 *       frame_1 (index 0): randomise rotation, scale.
 *       frame_52 (index 51): stop().
 *
 * Main timeline frame_1: SOMA.playSound("explosion").
 *
 * Since librarySymbols[] is empty, there are NO `lib_` prefixed textures.
 * The `anim1` animation is the bare name used with textures.getFrames("anim1").
 *
 * The outer sprite (DefineSprite_7) IS the anim1 timeline. We model it as the
 * root-attached symbol. DefineSprite_6 is an inner composite layer that is
 * baked into the pre-composited `anim1` frames — its random rotation/scale is
 * authored per-frame in the SVG exports; there is no separate lib symbol for it
 * and no runtime attach call in the canonical AS (it is placed by PlaceObject2
 * at compile time, not by attachMovie). We therefore model it as part of the
 * anim1 symbol's frame scripts: frame 0 applies a one-time random rotation+scale
 * to the root clip (mirroring what DefineSprite_6/frame_1 does), and frame 51
 * calls stop() on the inner clip. Since we only have the composite anim1, the
 * stop at frame 51 is applied to the anim1 clip itself to match the 52-frame
 * inner cap (the outer continues to frame 94 where removal fires).
 *
 * Wait — re-reading carefully: DefineSprite_6 and DefineSprite_7 are distinct
 * sprites. DefineSprite_7 IS the outermost and its frame_94 removes the parent
 * (the spell mc). DefineSprite_6 is a child inside DefineSprite_7. Since there
 * are no separate lib textures and no attachMovie calls, both are baked into
 * anim1. We model anim1 as a single SymbolDefinition (96 frames) with:
 *   - onLoad: apply random rotation + scale (mirrors DefineSprite_6/frame_1 logic
 *     on the inner child — applied to the composite sprite for visual variety)
 *   - frameScripts[93]: _parent.removeMovieClip() → this.runtime.complete()
 *
 * The inner stop at frame 52 is irrelevant at the anim1 level since the composite
 * already bakes the frozen inner layer into frames 52–95.
 *
 * signalHit: fired at frame 0 (impact frame — the explosion begins immediately).
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
  width: 204.95,
  height: 85.55,
  offsetX: -44.05,
  offsetY: -85.55,
};

export class Spell407 extends RuntimeSpell {
  readonly spellId = 407;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 is in animations[] only (no librarySymbols entry), so use
    // textures.getFrames("anim1") — NO lib_ prefix.
    const anim1Frames = textures.getFrames("anim1");

    // ---- anim1 — 96-frame explosion composite -------------------
    // Models DefineSprite_7 (outer, 96 frames) which contains
    // DefineSprite_6 (inner decorative layer, 52 frames) baked in.
    //
    // DefineSprite_6/frame_1/DoAction.as:
    //   _rotation = -40 - random(100);
    //   t = random(50) + 30;
    //   _xscale = t;
    //   _yscale = t;
    //
    // We apply this randomisation in onLoad so each instance gets
    // a unique rotation and scale, matching the per-instance random
    // seeding that the canonical AS inner sprite performs on its own
    // first frame.
    //
    // DefineSprite_7/frame_94/DoAction.as:
    //   _parent.removeMovieClip();
    // → frameScripts[93]: clip.parent?.remove() + this.runtime.complete()
    //
    // DefineSprite_6/frame_52/DoAction.as:
    //   stop();
    // → The inner clip stops at frame 52 but the outer continues.
    //   Since we have a single composite symbol we let the outer
    //   timeline run to frame 94 (index 93) for completion, and
    //   the baked SVGs already encode the frozen inner layer past
    //   frame 52. No separate stop() is needed on the composite.

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 96,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/DoAction.as:
        //   _rotation = -40 - random(100);
        //   t = random(50) + 30;
        //   _xscale = t; _yscale = t;
        const rotDeg = -40 - Math.floor(Math.random() * 100);
        clip.rotation = (rotDeg * Math.PI) / 180;
        const t = Math.floor(Math.random() * 50) + 30;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },

      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // Impact begins at frame 1 — signal hit immediately.
            this.runtime.signalHit();
          },
        ],
        [
          93,
          (clip) => {
            // AS DefineSprite_7/frame_94/DoAction.as:
            //   _parent.removeMovieClip();
            // The outer mc IS the root spell container — signal complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as:
    //   SOMA.playSound("explosion");
    callbacks.playSound("explosion");

    // Attach the anim1 composite at the root. The harness has already
    // positioned the root container at the target cell (TargetCell).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
