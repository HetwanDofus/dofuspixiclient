/**
 * Spell 411 — Lakam (Feca shield/buff spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/411/scripts/scripts/
 *
 * displayType=10 (CasterCell). The spell has no projectile, no target-anchored
 * impact, and no dual-anchored world-absolute layout. The single animation
 * (`anim1`) plays at the caster cell — a classic self-buff / shield pattern.
 * No `librarySymbols[]` entries exist in the manifest; `anim1` is the sole
 * animation and is referenced directly via `textures.getFrames("anim1")`.
 *
 * Library symbols:
 *   - DefineSprite_5 (anim1 sub-sprite, 109 frames):
 *       frame_1: random initial rotation, random scale [30,80]%, gotoAndPlay(random(21))
 *       frame_109: stop()
 *   - DefineSprite_8 (outer container, 148 frames):
 *       frame_148: _parent.removeMovieClip() + stop() → spell complete
 *
 * Main timeline: SOMA.playSound("lakam_409"); (frame_1/DoAction.as)
 *
 * Signal timing:
 *   - signalHit: fired at frame_1 of the outer container (instant self-buff,
 *     damage/effect applies immediately on cast).
 *   - complete: fired at frame_148 of DefineSprite_8 via _parent.removeMovieClip().
 *
 * No `librarySymbols[]` in manifest — textures loaded via bare animation name
 * `"anim1"` (NO `lib_` prefix).
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
  width: 160.7,
  height: 55.7,
  offsetX: 2.25,
  offsetY: -36.8,
};

export class Spell411 extends RuntimeSpell {
  readonly spellId = 411;
  readonly displayType = SpellDisplayType.CasterCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- DefineSprite_5 — rotating/scaled sub-sprite (109 frames) ----
    // This is the inner animated sprite that DefineSprite_8 (the outer
    // container, = anim1) places on its timeline. Since the manifest has
    // no librarySymbols[], the whole animation is baked into anim1's
    // frame textures. We model the outer anim1 directly as the registered
    // symbol with the frame scripts of DefineSprite_8 (the outermost
    // sprite), using anim1's 150-frame texture strip.
    //
    // The canonical SWF places DefineSprite_5 instances inside
    // DefineSprite_8; however, since all visual content is pre-composited
    // into the exported anim1 frames, we drive the lifecycle purely via
    // the outer DefineSprite_8 frame scripts on the anim1 symbol.
    //
    // DefineSprite_5/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   t = random(50) + 30;
    //   _xscale = t; _yscale = t;
    //   gotoAndPlay(random(21));
    //
    // DefineSprite_5/frame_109/DoAction.as:
    //   stop();
    //
    // These are inner-clip behaviours baked into the composite anim1
    // frames — no runtime attachMovie for DefineSprite_5 is needed
    // because the manifest has no librarySymbols[] entry for it.
    //
    // DefineSprite_8/frame_148/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();

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
            // AS DefineSprite_8 frame_1 (implicit — outer container starts).
            // Signal hit at the first frame: this is a self-buff, so the
            // effect applies immediately when the animation begins.
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip) => {
            // AS DefineSprite_8/frame_148/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
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
    //   SOMA.playSound("lakam_409");
    callbacks.playSound("lakam_409");

    // Attach the anim1 composite as a child of the root so it starts
    // ticking from the next runtime frame. For CasterCell the root is
    // anchored at the caster cell; anim1 is placed at root-local (0,0).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
