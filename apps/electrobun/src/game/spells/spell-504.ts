/**
 * Spell 504 — Nombreux (many / summoning wave, likely Osamodas or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/504/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored composite
 * timeline (`anim1`, 246 frames) in `animations[]` with no `librarySymbols[]`
 * entries — there are no `attachMovie` calls for runtime-spawned particles;
 * instead, all child clips are placed directly on the authored timelines of
 * the DefineSprites that form the composite. The outer DefineSprite_15 holds
 * frame_244/DoAction.as → `_parent.removeMovieClip(); stop();` which is the
 * canonical completion signal.
 *
 * The AS scripts describe five nested DefineSprite behaviours:
 *
 *   - DefineSprite_3  — a bouncing/gravity particle. onLoad seeds v=0;
 *                       onEnterFrame integrates gravity (v += 0.6), bounces
 *                       at Y=0, with random vx.
 *
 *   - DefineSprite_9  — contains two placed children:
 *       PlaceObject2_6_1 (enterFrame): sets _alpha to abs(_parent._xscale)
 *                                       when > 95, else 0.
 *       PlaceObject2_8_3 (load):       seeds random scale t ∈ [80,130].
 *
 *   - DefineSprite_10 — a sinusoidal wobble ring. onLoad: random rotation,
 *                       random alpha ∈ [40,90), phase i. onEnterFrame:
 *                       xscale = 100 * sin(i += 0.06).
 *
 *   - DefineSprite_13 — flickering alpha particle. onEnterFrame: sets
 *                       _alpha = random(170).
 *
 *   - DefineSprite_14 — rising spiral particle. onLoad: seeds p, i, v2
 *                       (rotation speed), random rotation, alpha=120,
 *                       parent._alpha=10, v (rise speed). onEnterFrame:
 *                       spiral rise + fade logic; calls
 *                       _parent.removeMovieClip() when fully faded.
 *
 *   - DefineSprite_15 — outer container, 246-frame timeline. frame_244
 *                       (0-based: 243): `_parent.removeMovieClip(); stop();`
 *                       → spell complete.
 *
 * All of these are AUTHORED children placed on the composite timeline —
 * NOT runtime-spawned via attachMovie. The manifest has no `librarySymbols[]`,
 * so NO `lib_` prefix is used anywhere. The single `animations` entry `anim1`
 * carries all the composite frame textures.
 *
 * Because these clips are baked into the authored timeline composite (the
 * exporter flattened them into `anim1` frames), we model the outer spell as
 * a single `anim1` symbol whose timeline drives completion. The per-clip
 * behaviours (DefineSprite_3/9/10/13/14) exist inside the authored frames
 * visually, but since there are no runtime attachMovie calls from our TS
 * code, we don't need to register them as separate SymbolDefinitions. We
 * only need to:
 *   1. Register `anim1` as the main symbol (246 frames, textures from "anim1").
 *   2. On frame 243 (AS frame_244): call runtime.complete().
 *   3. Signal hit at an appropriate frame — there is no explicit `this.end()`
 *      in the canonical AS (unlike spell 909), so we fire signalHit at
 *      frame_1 (frame 0) as an instant-impact spell at the target cell.
 *
 * Main timeline frame_1: SOMA.playSound("many_504").
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
  width: 60.35,
  height: 38,
  offsetX: -22.6,
  offsetY: -25.15,
};

export class Spell504 extends RuntimeSpell {
  readonly spellId = 504;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite 246-frame spell timeline ---------------
    // The canonical outer container is DefineSprite_15 whose
    // frame_244/DoAction.as fires `_parent.removeMovieClip(); stop();`
    // We model this as the single top-level symbol with 246 frames.
    // The harness places it at the target cell (displayType=11).
    //
    // frame 0   (AS frame_1): instant impact — signal hit.
    // frame 243 (AS frame_244): _parent.removeMovieClip() → complete.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 246,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS frame_1 — spell lands instantly at target cell;
            // signal hit so damage popup fires at animation start.
            this.runtime.signalHit();
          },
        ],
        [
          243,
          (clip) => {
            // AS DefineSprite_15/frame_244/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
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
    // AS scripts/frame_1/DoAction.as:
    //   SOMA.playSound("many_504");
    callbacks.playSound("many_504");

    // Attach the anim1 symbol as the root content so it starts ticking.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
