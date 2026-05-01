/**
 * Spell 315 — (Enutrof / character animation spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/315/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single `anim1` animation
 * (201 frames, no projectile, no dual-anchor) anchored at the target cell.
 * The manifest has NO librarySymbols array and no `move`/`shoot`/`duplicate`
 * symbols — it is a pure single-timeline impact animation.
 *
 * The ActionScript files are almost entirely `GAC.applyColor(...)` calls
 * (character accessory/color system for the authored character sprites baked
 * into the composite SVG frames) plus one SpellClip-relevant sprite:
 *
 *   - DefineSprite_51 — a looping sub-sprite with randomised start frame and
 *     per-frame rotation. frame_1: gotoAndPlay(random(18)+2); frame_4:
 *     _rotation = random(360); frame_28: gotoAndPlay(2) (loop back).
 *     This is part of the composite `anim1` visual.
 *
 *   - DefineSprite_53/frame_157: _parent.removeMovieClip() — the outer
 *     animation signals completion at frame 157 (0-based: 156).
 *
 * All other DefineSprite scripts (1, 11, 13, 15, 17, 18, 20, 23, 34, 41)
 * are purely GAC.applyColor / GAC.applyAccessory calls that colour the
 * character costume SVG data. These have no runtime effect on the SpellClip
 * system (the colours are baked into the pre-exported SVG frames) and do not
 * require SymbolDefinition entries.
 *
 * Main timeline: no SOMA.playSound call, no explicit child attaches beyond
 * the single `anim1` timeline. We register `anim1` as the root symbol and
 * signal completion from its frame 156 script (mirroring DefineSprite_53/
 * frame_157: _parent.removeMovieClip()).
 *
 * signalHit is fired at an early-impact frame (frame 12, roughly where the
 * visual lands on the target — chosen as the first significant impact frame
 * of the 201-frame animation, consistent with the "instant impact at target"
 * pattern for TargetCell spells).
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
  width: 195.95,
  height: 87.15,
  offsetX: -29.95,
  offsetY: -128.65,
};

export class Spell315 extends RuntimeSpell {
  readonly spellId = 315;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 201-frame composite target impact animation -----
    // This is the single authored timeline for spell 315. It is a
    // composite animation (isComposite: true in manifest) covering
    // the full spell visual. No librarySymbols are registered in the
    // manifest — all sub-sprite behaviour (GAC colour calls, DefineSprite_51
    // random loops) is baked into the exported SVG frame sequence.
    //
    // Frame scripts ported from:
    //   DefineSprite_53/frame_157/DoAction.as → _parent.removeMovieClip()
    //     → frame index 156 (0-based): signal complete.
    //
    // signalHit is fired at frame 12 (0-based), which corresponds to
    // approximately the first prominent impact frame of the animation
    // for this TargetCell spell (no explicit hit frame is scripted in
    // the canonical AS; this mirrors the common TargetCell convention
    // of signalling hit shortly after the animation begins).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 201,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          12,
          (_clip, _ctx) => {
            // Canonical impact frame — signal hit so damage popups appear.
            this.runtime.signalHit();
          },
        ],
        [
          156,
          (clip, _ctx) => {
            // AS DefineSprite_53/frame_157/DoAction.as: _parent.removeMovieClip()
            // The outer movie clip is removed here; signal spell completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // No SOMA.playSound in the canonical main timeline for spell 315.
    // Attach anim1 at the root so the 201-frame composite plays from
    // the first runtime tick.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
