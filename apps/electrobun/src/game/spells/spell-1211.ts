/**
 * Spell 1211 — (Unknown name, likely a heavy impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1211/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile (no `move`/`shoot` pattern),
 * no caster reference, no dual-anchor. A single `anim1` timeline plays at the target
 * cell, driven by one top-level composite symbol. No `librarySymbols[]` entries exist
 * in the manifest — all symbols are referenced only in `animations[]`.
 *
 * Canonical AS layout:
 *   - DefineSprite_22/frame_1 — main timeline entry: SOMA.playSound("impact_lourd").
 *
 *   - DefineSprite_28 (outer wrapper / anim1, 81 frames):
 *       frame_79: stop(); _parent.removeMovieClip() → spell complete.
 *       (stopFrame=78 in manifest means frame index 78 is the last rendered frame;
 *        the AS fires at frame_79 = index 78, then stops and removes.)
 *
 *   - DefineSprite_27 — a bouncing weight sub-sprite ("poids"):
 *       frame_1: seeds scale (50-100%), random h (-20 to +20 px), gravity g=0.5,
 *                alpha=1.67, vy=0, hit=0; starts poids gotoAndPlay(random(24)+1).
 *       onEnterFrame: alpha ramps up (+5) until hitting h, then fades (-3.34);
 *                     integrates vy with gravity; bounces at y=h with 0.3 restitution;
 *                     on hit: fumee.play(), poids.stop().
 *
 *   - DefineSprite_26 — "fumee" (smoke puff):
 *       frame_1: stop().
 *
 *   - DefineSprite_25 — "poids" (the weight particle):
 *       frame_1: seeds va (fade rate), scale (50-100%), random rotation, starts
 *                onEnterFrame that decrements alpha by va.
 *       PlaceObject2_24_1 onClipEvent(load): vx = 1.67 + random(1.67).
 *       PlaceObject2_24_1 onClipEvent(enterFrame): _X += vx; vx *= 0.97.
 *
 * NOTE: The manifest has no `librarySymbols[]` entries. The `anim1` animation is
 * the top-level composite. The inner DefineSprite symbols are sub-sprites of anim1.
 * Since the manifest only has `animations: [{name: "anim1"}]`, we use
 * `textures.getFrames("anim1")` (no `lib_` prefix). The inner symbols (DefineSprite_26,
 * 27, 25) are container-only sub-sprites whose authored textures are embedded in the
 * composite anim1 frames — they are driven by the anim1 composite.
 *
 * Because the spell is a pure impact animation at the target cell with no projectile
 * or caster reference, displayType=11 (TargetCell) is the correct choice.
 *
 * signalHit is fired from the anim1 frame_1 script (immediate impact on placement).
 * complete() is fired from frame_79 (= index 78) where canonical AS does
 * `_parent.removeMovieClip()`.
 *
 * Library symbols:
 *   - anim1 (composite, 81 frames) — top-level impact animation. frame_1 signals hit;
 *     frame_79 (index 78) stops and calls complete().
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
  width: 87.9,
  height: 78.95,
  offsetX: -43.15,
  offsetY: -173.05,
};

export class Spell1211 extends RuntimeSpell {
  readonly spellId = 1211;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite impact animation at target cell -------
    // The outer DefineSprite_28 drives an 81-frame composite animation.
    // AS DefineSprite_28/frame_79/DoAction.as: stop(); _parent.removeMovieClip()
    // Manifest stopFrame=78 means index 78 is frame_79 in AS (1-based).
    // The inner sub-sprites (DefineSprite_26 "fumee", DefineSprite_27 "poids holder",
    // DefineSprite_25 "poids") are embedded in the composite frames — their authored
    // logic (bouncing weight, smoke, drifting particle) is baked into the SVG frames
    // by the exporter. We don't need to reproduce their runtime logic separately
    // because the composite anim1 frames already contain the full visual.
    //
    // signalHit fires at frame_1 (index 0) — impact is immediate on placement.
    // complete() fires at frame_79 (index 78) matching the canonical removeMovieClip.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 81,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS DefineSprite_22/frame_1/DoAction.as: SOMA.playSound("impact_lourd")
            // Sound is handled in onSpellStart; signal hit immediately on impact.
            this.runtime.signalHit();
          },
        ],
        [
          78,
          (clip, _ctx) => {
            // AS DefineSprite_28/frame_79/DoAction.as:
            //   stop();
            //   _parent.removeMovieClip();
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
    // AS DefineSprite_22/frame_1/DoAction.as: SOMA.playSound("impact_lourd");
    callbacks.playSound("impact_lourd");

    // Attach the main animation composite at the root (target cell anchor).
    // displayType=11 means root is already at target; anim1 placed at (0,0) local.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
