/**
 * Spell 801 — Vlad (unknown class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/801/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no move/shoot/duplicate
 * pattern, no caster-side anchor, no dual-anchored timeline. The
 * single top-level animation (`anim1`, 306 frames) plays at the
 * target cell. No `librarySymbols[]` in manifest — `anim1` appears
 * only in `animations[]`, so textures are fetched under the bare
 * `"anim1"` key (no `lib_` prefix).
 *
 * The manifest lists several DefineSprite symbols whose clip events
 * are provided in the scripts. However, since no `attachMovie` calls
 * appear in the canonical AS source (no frame DoAction scripts drive
 * attachMovie), these appear to be authored children placed directly
 * on sub-timelines of the composite `anim1`. The outer shell
 * (`DefineSprite_14`, 306 frames) has only one frame script:
 * `frame_304/DoAction.as` → `_parent.removeMovieClip()` which signals
 * completion. This is registered at frame index 303 (0-based).
 *
 * signalHit is fired at the same frame (the removal/impact frame 303).
 *
 * Library symbols (all authored children, no runtime attachMovie):
 *   - DefineSprite_9:  scale particle. onLoad: random scale [80,130)%.
 *   - DefineSprite_10: flickering overlay. onLoad: random rotation,
 *                      alpha, phase. onEnterFrame: xscale oscillates.
 *   - DefineSprite_3:  gravity bounce particle. onLoad: v=0. onEnterFrame:
 *                      falls with gravity, bounces at Y=0.
 *   - DefineSprite_13: spinning spiral particle. onLoad: seeds st/i/p/v2/
 *                      rotation/alpha/parent._alpha/v. onEnterFrame:
 *                      spirals up, fades, removes parent at threshold.
 *   - DefineSprite_12: random-alpha flicker. onEnterFrame: random alpha.
 *
 * Since none of these are attached via `attachMovie` in frame scripts,
 * and the manifest has no `librarySymbols[]` entries, we register
 * `anim1` as the single symbol (the full 306-frame composite animation)
 * and attach it from `onSpellStart`. The authored child behaviours
 * (DefineSprite_9/10/3/13/12) are baked into the exported per-frame
 * SVG composites and do not need separate runtime particles here.
 *
 * Main timeline: SOMA.playSound("vlad_801"); (frame_1/DoAction.as)
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
  width: 46.35,
  height: 29.35,
  offsetX: -22.6,
  offsetY: -16.1,
};

export class Spell801 extends RuntimeSpell {
  readonly spellId = 801;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 306-frame composite animation at target cell ----
    // Canonical outer shell: DefineSprite_14 (306 frames).
    // frame_304/DoAction.as: _parent.removeMovieClip() → complete.
    // signalHit fired at the same removal frame (303, 0-based).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 306,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          303,
          (clip) => {
            // AS DefineSprite_14/frame_304/DoAction.as:
            //   _parent.removeMovieClip();
            // This is the outer mc removal — signal hit and complete.
            this.runtime.signalHit();
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
    // AS frame_1/DoAction.as: SOMA.playSound("vlad_801");
    callbacks.playSound("vlad_801");

    // Attach the main animation at the target cell (root is already
    // anchored there by the TargetCell harness at world origin 0,0).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
