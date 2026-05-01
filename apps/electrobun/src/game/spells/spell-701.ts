/**
 * Spell 701 — Grina (Sram/Enutrof trap-style impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/701/scripts/scripts/
 *
 * displayType=11 (TargetCell). No library symbols are attachMovie'd dynamically;
 * the spell is a single composite animation (`anim1`, 105 frames) that plays at the
 * target cell. There is no `move`, `shoot`, or `duplicate` symbol — no projectile
 * path, no caster reference — so TargetCell is the correct displayType.
 *
 * The manifest has no `librarySymbols[]` entries. All content lives in `animations[]`
 * as a single entry named `"anim1"`. Textures are accessed under the bare key `"anim1"`
 * (no `lib_` prefix).
 *
 * AS layout:
 *   - DefineSprite_14 is the outer/main-timeline sprite (105-frame composite).
 *       frame_1/DoAction.as : SOMA.playSound("grina_701");
 *       frame_103/DoAction.as: _parent.removeMovieClip();
 *
 *   - DefineSprite_10 is an inner sub-sprite (referenced by the composite frames).
 *       frame_1/DoAction.as : gotoAndStop(random(6) + 1);
 *       This drives a random 1-of-6 hold-frame for a decorative sub-element baked
 *       into the composite SVG export. Because the combat-exporter has rasterised
 *       the composite as individual per-frame SVGs that already include the chosen
 *       sub-sprite frame, there is no separate lib_* asset to register and no
 *       runtime attach is needed. The sound and removal signals are what matter.
 *
 * Signals:
 *   - signalHit: fired at frame_1 (frame index 0) — the impact flash is immediate.
 *   - complete:  fired at frame_103 (frame index 102) via _parent.removeMovieClip().
 *
 * Main timeline (onSpellStart): plays the sound; the anim1 symbol is attached at
 * depth 1 and ticks through its 105-frame timeline automatically.
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
  width: 126,
  height: 76.55,
  offsetX: -25.95,
  offsetY: -13.6,
};

export class Spell701 extends RuntimeSpell {
  readonly spellId = 701;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 105-frame composite impact animation -----------
    // AS DefineSprite_14/frame_1/DoAction.as  : SOMA.playSound("grina_701")
    //    (sound handled in onSpellStart; frame_1 script only needs to
    //    signal hit since the impact visual begins immediately)
    // AS DefineSprite_14/frame_103/DoAction.as: _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 105,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_14/frame_1/DoAction.as — impact starts now.
            // Sound is played from onSpellStart (SOMA.playSound lives on
            // the main timeline in canonical AS). Signal hit at the first
            // visible impact frame.
            this.runtime.signalHit();
          },
        ],
        [
          102,
          (clip) => {
            // AS DefineSprite_14/frame_103/DoAction.as
            // _parent.removeMovieClip() — the outer mc is removed, ending
            // the spell. clip here IS the anim1 child; its parent is root.
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
    // AS DefineSprite_14/frame_1/DoAction.as: SOMA.playSound("grina_701");
    // Also matches manifest sounds[0]: { frame: 0, soundId: "grina_701" }
    callbacks.playSound("grina_701");

    // Attach the main composite animation at depth 1 so it starts
    // ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
