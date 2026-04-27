/**
 * Spell 503 — Maîtrise des Sorts (Xelor / Enutrof area spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/503/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster
 * reference, no `move`/`shoot`/`duplicate` symbols, no `_parent.cellFrom`
 * reads — it is a pure impact animation anchored at the target cell.
 * The manifest has a single `animations` entry (`anim1`, 222 frames,
 * composite) and an empty `librarySymbols[]` array. No library symbols
 * are ever `attachMovie`'d by the canonical AS; the animation plays as
 * a single authored timeline.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * The manifest `animations[]` entry (`anim1`) drives the visual:
 *   - 222-frame composite rendered as the `anim1` symbol.
 *   - The manifest `stopFrame=219` / `fadingFrame=218` indicate the
 *     authored timeline ends at frame 220 (1-based), matching the
 *     canonical `DefineSprite_15/frame_220/DoAction.as`:
 *       `_parent.removeMovieClip(); stop();`
 *     which removes the outer mc and ends the spell.
 *
 * Sub-sprite clip events present in the AS but driven entirely by the
 * authored composite frames (they are inner clips of the composite that
 * the exporter has already baked into the frame SVGs):
 *   - DefineSprite_5 / PlaceObject2_4_2 onClipEvent(enterFrame):
 *       `_rotation = _rotation + 3.3;`  — rotating ring element.
 *   - DefineSprite_12 / PlaceObject2_8_45 onClipEvent(load):
 *       `i = 0;`
 *   - DefineSprite_12 / PlaceObject2_8_45 onClipEvent(enterFrame):
 *       `if (i++ % 8 == 1) { _rotation = _rotation - 13.4; }`
 *   - DefineSprite_12 / PlaceObject2_11_49 onClipEvent(enterFrame):
 *       `_rotation = _rotation + 1;`
 * These are inner sub-clips of the composite `anim1` timeline; their
 * authored motion is already captured in the per-frame SVG exports.
 * No separate SymbolDefinition is required for them.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("many_503");
 *
 * signalHit: fired at frame 220 (0-based 219) — the canonical impact /
 * removal frame, where `_parent.removeMovieClip()` executes in AS.
 * complete: fired at the same frame (the outer mc is removed there).
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
  width: 453.25,
  height: 464.05,
  offsetX: -54.4,
  offsetY: -414.65,
};

export class Spell503 extends RuntimeSpell {
  readonly spellId = 503;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 222-frame composite impact animation ------------
    // Canonical AS: DefineSprite_15/frame_220/DoAction.as
    //   `_parent.removeMovieClip(); stop();`
    // The composite contains inner rotating sub-clips (DefineSprite_5,
    // DefineSprite_12) whose clip events are baked into the exported
    // SVG frames. We model only the timeline lifecycle here.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 222,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          219,
          (clip) => {
            // AS DefineSprite_15/frame_220/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
            this.runtime.signalHit();
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
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("many_503");
    callbacks.playSound("many_503");

    // Attach the single authored composite timeline at depth 1.
    // The harness has already positioned the container at the target
    // cell; the child attaches at (0,0) within it.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
