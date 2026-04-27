/**
 * Spell 315 — (Xelor/Enutrof composite animation, likely "Roulette" or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/315/scripts/scripts/
 *
 * displayType=11 (TargetCell). Analysis:
 *   - No `move` / `shoot` / `duplicate` symbols in manifest.
 *   - No `librarySymbols[]` array in manifest — only a single `animations[]` entry
 *     named `anim1` (201 frames, composite).
 *   - All DefineSprite_* scripts are either `GAC.applyColor(...)` (character
 *     customisation, no spell-logic impact) or timeline navigation on DefineSprite_51
 *     (a looping sub-clip) and DefineSprite_53 (the outermost timeline, 157 frames,
 *     whose frame_157 calls `_parent.removeMovieClip()` — the canonical completion
 *     signal).
 *   - No caster-reference, no projectile, no dual-anchor pattern → TargetCell.
 *
 * Library symbols: none (manifest `librarySymbols` is absent / empty).
 *
 * The `anim1` timeline is the sole visual content. It is registered as a
 * container-only SymbolDefinition whose frameScripts drive the two key
 * runtime events:
 *
 *   - signalHit: fired at frame_4 of DefineSprite_51 (the innermost spark
 *     loop). Because DefineSprite_51 is a sub-clip of anim1 that the extractor
 *     baked into the composite frames, the canonical hit moment corresponds to
 *     the visible impact onset. In the absence of a separate `shoot` we use
 *     the earliest authored action that touches the target — frame_4 of the
 *     internal loop — mapped here to a reasonable early frame on the anim1
 *     timeline. However, since DefineSprite_53/frame_157 is the outermost
 *     removal frame and the extractor produced 201 composite frames (the extra
 *     frames are trailing duplicates), the safest canonical hit signal is at
 *     the point where the impact animation begins — approximately frame 4 of
 *     the baked composite — and completion is at frame 156 (AS frame_157,
 *     0-based 156) which is `_parent.removeMovieClip()`.
 *
 * Main timeline: no SOMA.playSound in the provided scripts; onSpellStart
 * attaches the anim1 clip.
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

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 201-frame composite baked timeline --------------
    // Canonical outer removal: DefineSprite_53/frame_157/DoAction.as
    //   _parent.removeMovieClip();
    // Maps to frameScripts.set(156, ...) (0-based).
    //
    // Canonical hit: DefineSprite_51/frame_4/DoAction.as
    //   _rotation = random(360);
    // This is the first frame of the inner spark loop that visually
    // impacts the target. Mapped to frameScripts.set(3, ...) here.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 201,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          3,
          (_clip) => {
            // AS DefineSprite_51/frame_4/DoAction.as — first target-impact
            // frame of the inner spark loop. Signal hit so damage popups
            // appear at the canonical onset of the impact visual.
            this.runtime.signalHit();
          },
        ],
        [
          156,
          (clip) => {
            // AS DefineSprite_53/frame_157/DoAction.as:
            //   _parent.removeMovieClip();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // No SOMA.playSound found in the provided canonical scripts.
    // Attach the main composite timeline so it begins ticking from
    // the first runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
